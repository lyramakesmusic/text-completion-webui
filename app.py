from flask import Flask, render_template, request, jsonify, Response, session
import requests
import json
import os
import uuid
import datetime
import logging
from threading import Timer
from threading import Lock
import numpy as np
from model2vec import StaticModel

# ============================
# Embeddings Configuration
# ============================
EMBEDDINGS_SIMILARITY_THRESHOLD = 0.1  # Cosine similarity threshold for search results

# Set up logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.urandom(24)  # For session management

# ============================
# Configuration and Setup
# ============================

# Paths
try:
    home_dir = os.path.expanduser('~')
    logger.info(f"Home directory resolved to: {home_dir}")
    CONFIG_DIR = os.path.join(home_dir, '.openrouter-flask')
    logger.info(f"Config directory path: {CONFIG_DIR}")
    
    # Check if directory exists and is writable
    if os.path.exists(CONFIG_DIR):
        logger.info(f"Config directory exists at {CONFIG_DIR}")
        # Check permissions
        if os.access(CONFIG_DIR, os.W_OK):
            logger.info("Config directory is writable")
        else:
            logger.error("Config directory is not writable")
    else:
        logger.info("Config directory does not exist, will create it")
except Exception as e:
    logger.error(f"Error resolving home directory: {e}")
    # Fallback to current directory if home directory resolution fails
    CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.openrouter-flask')
    logger.info(f"Using fallback config directory: {CONFIG_DIR}")

CONFIG_FILE = os.path.join(CONFIG_DIR, 'config.json')
DOCUMENTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'content')

# Default configuration
DEFAULT_CONFIG = {
    'token': '',
    'model': 'deepseek/deepseek-v3-base:free',
    'endpoint': 'https://openrouter.ai/api/v1/completions',
    'temperature': 1.0,
    'min_p': 0.01,
    'presence_penalty': 0.1,
    'repetition_penalty': 1.1,
    'max_tokens': 500,
    'current_document': None,
    'documents': [],  # List of document IDs
    'dark_mode': True,  # Default to dark mode
    'provider': 'openrouter',  # 'openrouter', 'openai', 'chutes'
    'custom_api_key': '',  # Optional custom API key for specific providers
    'openai_endpoint': 'http://localhost:8080/v1',  # Only for OpenAI-compatible provider
    'embeddings_search': True  # Use embeddings search by default
}

# Active generation requests
active_generations = {}

# In-memory document storage
documents_cache = {}
write_timer = None
write_lock = Lock()
WRITE_DELAY = 1.0  # seconds

# Embeddings model - initialize lazily
embeddings_model = None

def get_embeddings_model():
    """Get or initialize the embeddings model"""
    global embeddings_model
    if embeddings_model is None:
        try:
            logger.info("Loading embeddings model...")
            embeddings_model = StaticModel.from_pretrained("minishlab/potion-base-8M")
            logger.info("Embeddings model loaded successfully")
        except Exception as e:
            logger.error(f"Error loading embeddings model: {e}")
            embeddings_model = None
    return embeddings_model

def calculate_text_embedding(text):
    """Calculate embedding for a text string with performance optimizations"""
    if not text or not text.strip():
        logger.debug("Empty text provided for embedding")
        return None
        
    model = get_embeddings_model()
    if model is None:
        logger.error("Embeddings model is None")
        return None
        
    try:
        # Clean the text - remove extra whitespace
        clean_text = ' '.join(text.strip().split())
        
        # Performance optimization: use different strategies based on text length
        if len(clean_text) > 50000:
            # For very large documents, use a sample from beginning and end
            beginning = clean_text[:2000]
            end = clean_text[-2000:]
            clean_text = beginning + " ... " + end
            logger.debug(f"Large document detected ({len(text)} chars), using sample for embedding")
        elif len(clean_text) > 8000:
            # For medium documents, truncate more aggressively
            clean_text = clean_text[:8000]
            logger.debug(f"Medium document detected, truncating to 8000 chars for embedding")
        elif len(clean_text) > 5000:
            # For smaller large documents, use original limit
            clean_text = clean_text[:5000]
            
        logger.debug(f"Calculating embedding for text: {clean_text[:50]}...")
        embeddings = model.encode([clean_text])
        result = embeddings[0].tolist()  # Convert numpy array to list for JSON storage
        logger.debug(f"Embedding calculated successfully, length: {len(result)}")
        return result
    except Exception as e:
        logger.error(f"Error calculating embedding: {e}")
        return None

def cosine_similarity(vec1, vec2):
    """Calculate cosine similarity between two vectors"""
    if not vec1 or not vec2:
        return 0.0
        
    try:
        # Convert to numpy arrays
        a = np.array(vec1)
        b = np.array(vec2)
        
        # Calculate cosine similarity
        dot_product = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
            
        return dot_product / (norm_a * norm_b)
    except Exception as e:
        logger.error(f"Error calculating cosine similarity: {e}")
        return 0.0

# Ensure directories exist
try:
    os.makedirs(CONFIG_DIR, exist_ok=True)
    logger.info(f"Created/verified config directory: {CONFIG_DIR}")
    # Check permissions after creation
    if os.access(CONFIG_DIR, os.W_OK):
        logger.info("Config directory is writable")
    else:
        logger.error("Config directory is not writable")
except Exception as e:
    logger.error(f"Error creating config directory: {e}")
    # Try to create in current directory as fallback
    CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.openrouter-flask')
    os.makedirs(CONFIG_DIR, exist_ok=True)
    logger.info(f"Created fallback config directory: {CONFIG_DIR}")

try:
    os.makedirs(DOCUMENTS_DIR, exist_ok=True)
    logger.info(f"Created/verified documents directory: {DOCUMENTS_DIR}")
except Exception as e:
    logger.error(f"Error creating documents directory: {e}")

# ============================
# Configuration Functions
# ============================

def load_config():
    """Load application configuration from file"""
    config = DEFAULT_CONFIG.copy()
    
    if os.path.exists(CONFIG_FILE):
        try:
            logger.info(f"Loading config from {CONFIG_FILE}")
            with open(CONFIG_FILE, 'r') as f:
                saved_config = json.load(f)
                logger.info(f"Loaded config: {json.dumps(saved_config, indent=2)}")
                config.update(saved_config)
            logger.info("Configuration loaded successfully")
            
            # Verify token is loaded correctly
            if config.get('token'):
                logger.info("Token is present in config")
            else:
                logger.warning("No token found in config")
        except Exception as e:
            logger.error(f"Error loading configuration: {e}")
    else:
        logger.info("No config file found, using defaults")
        save_config(config)
        
    return config

def save_config(config):
    """Save application configuration to file"""
    try:
        logger.info(f"Saving config to {CONFIG_FILE}")
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        logger.info(f"Configuration saved successfully to {CONFIG_FILE}")
        
        # Verify file was created and is readable
        if os.path.exists(CONFIG_FILE):
            logger.info("Config file exists after save")
            if os.access(CONFIG_FILE, os.R_OK):
                logger.info("Config file is readable")
            else:
                logger.error("Config file is not readable")
        else:
            logger.error("Config file was not created")
            
        return True
    except Exception as e:
        logger.error(f"Error saving configuration: {e}")
        return False

# Load configuration at app startup
config = load_config()

# ============================
# Document Management Functions
# ============================

def get_document_path(doc_id):
    """Get the file path for a document"""
    return os.path.join(DOCUMENTS_DIR, f"{doc_id}.json")

def schedule_write():
    """Schedule a write of the documents cache to disk"""
    global write_timer
    if write_timer:
        write_timer.cancel()
    write_timer = Timer(WRITE_DELAY, write_documents_to_disk)
    write_timer.start()

def write_documents_to_disk():
    """Write all cached documents to disk"""
    with write_lock:
        for doc_id, document in documents_cache.items():
            doc_path = get_document_path(doc_id)
            try:
                with open(doc_path, 'w') as f:
                    json.dump(document, f, indent=2)
                logger.info(f"Document {doc_id} saved to disk")
            except Exception as e:
                logger.error(f"Error saving document {doc_id} to disk: {e}")

def load_document(doc_id):
    """Load a document from cache or disk"""
    # Check cache first
    if doc_id in documents_cache:
        logger.info(f"Document {doc_id} loaded from cache")
        return documents_cache[doc_id]
    
    # Load from disk if not in cache
    doc_path = get_document_path(doc_id)
    if not os.path.exists(doc_path):
        logger.warning(f"Document {doc_id} not found")
        return None
    
    try:
        with open(doc_path, 'r') as f:
            document = json.load(f)
            # Add to cache
            documents_cache[doc_id] = document
            logger.info(f"Document {doc_id} loaded from disk and cached")
            return document
    except Exception as e:
        logger.error(f"Error loading document {doc_id}: {e}")
        return None

def save_document(doc_id, document):
    """Save a document to cache and schedule disk write"""
    try:
        # Update cache
        documents_cache[doc_id] = document
        # Schedule write to disk
        schedule_write()
        logger.info(f"Document {doc_id} saved to cache")
        return True
    except Exception as e:
        logger.error(f"Error saving document {doc_id}: {e}")
        return False

def delete_document(doc_id):
    """Delete a document from cache and disk"""
    with write_lock:
        # Remove from cache
        if doc_id in documents_cache:
            del documents_cache[doc_id]
        
        # Remove from disk
        doc_path = get_document_path(doc_id)
        if os.path.exists(doc_path):
            try:
                os.remove(doc_path)
                # Update config
                if doc_id in config['documents']:
                    config['documents'].remove(doc_id)
                if config['current_document'] == doc_id:
                    config['current_document'] = None if not config['documents'] else config['documents'][0]
                save_config(config)
                logger.info(f"Document {doc_id} deleted successfully")
                return True
            except Exception as e:
                logger.error(f"Error deleting document {doc_id}: {e}")
        return False

def create_new_document(name="Untitled"):
    """Create a new document with basic structure"""
    doc_id = str(uuid.uuid4())
    now = datetime.datetime.now().isoformat()
    
    # Calculate embeddings for the document name
    name_embedding = calculate_text_embedding(name)
    
    document = {
        'id': doc_id,
        'name': name,
        'created_at': now,
        'updated_at': now,
        'content': '',
        'content_embedding': None,  # No content yet
        'name_embedding': name_embedding
    }
    
    if save_document(doc_id, document):
        # Update config
        if doc_id not in config['documents']:
            config['documents'].append(doc_id)
        config['current_document'] = doc_id
        save_config(config)
        return doc_id, document
    return None, None

def update_document_metadata(doc_id, name=None):
    """Update a document's metadata without changing content"""
    document = load_document(doc_id)
    if not document:
        return False, None
    
    if name:
        document['name'] = name
        # Recalculate name embedding
        document['name_embedding'] = calculate_text_embedding(name)
    document['updated_at'] = datetime.datetime.now().isoformat()
    
    if save_document(doc_id, document):
        return True, document
    return False, None

def update_document_content(doc_id, content):
    """Update a document's content with embedding caching"""
    document = load_document(doc_id)
    if not document:
        return False, None
    
    # Check if content actually changed to avoid unnecessary embedding calculation
    old_content = document.get('content', '')
    if old_content == content:
        logger.debug(f"Content unchanged for document {doc_id}, skipping embedding recalculation")
        return True, document
    
    document['content'] = content
    document['updated_at'] = datetime.datetime.now().isoformat()
    
    # Only recalculate embedding if content changed significantly
    # For performance on large docs, skip embedding if only minor changes
    content_diff = abs(len(content) - len(old_content))
    if content_diff > 100 or not document.get('content_embedding'):
        # Recalculate content embedding only if significant change or no existing embedding
        document['content_embedding'] = calculate_text_embedding(content)
        logger.debug(f"Recalculated embedding for document {doc_id} (diff: {content_diff} chars)")
    else:
        logger.debug(f"Skipped embedding recalculation for document {doc_id} (minor change: {content_diff} chars)")
    
    if save_document(doc_id, document):
        return True, document
    return False, None

def get_document_metadata(doc_id, include_content=True):
    """Get document metadata with optional content inclusion for performance"""
    # Check cache first
    if doc_id in documents_cache:
        doc = documents_cache[doc_id]
        metadata = {
            'id': doc_id,
            'name': doc.get('name', 'Untitled'),
            'updated_at': doc.get('updated_at'),
            'created_at': doc.get('created_at'),
            'content_embedding': doc.get('content_embedding'),
            'name_embedding': doc.get('name_embedding')
        }
        # Only include content if requested and needed
        if include_content:
            content = doc.get('content', '')
            # For search performance, truncate very large content for keyword search
            if len(content) > 100000:  # 100KB limit for search
                metadata['content'] = content[:100000] + "..."
                metadata['content_truncated'] = True
            else:
                metadata['content'] = content
                metadata['content_truncated'] = False
        return metadata
    
    # Load from disk if not in cache
    doc_path = get_document_path(doc_id)
    if not os.path.exists(doc_path):
        return None
    
    try:
        with open(doc_path, 'r') as f:
            document = json.load(f)
            # Add to cache
            documents_cache[doc_id] = document
            metadata = {
                'id': doc_id,
                'name': document.get('name', 'Untitled'),
                'updated_at': document.get('updated_at'),
                'created_at': document.get('created_at'),
                'content_embedding': document.get('content_embedding'),
                'name_embedding': document.get('name_embedding')
            }
            if include_content:
                content = document.get('content', '')
                if len(content) > 100000:
                    metadata['content'] = content[:100000] + "..."
                    metadata['content_truncated'] = True
                else:
                    metadata['content'] = content
                    metadata['content_truncated'] = False
            return metadata
    except Exception as e:
        logger.error(f"Error loading document metadata {doc_id}: {e}")
        return None

def get_all_documents():
    """Get list of all documents with metadata"""
    documents = []
    for doc_id in config['documents']:
        doc_meta = get_document_metadata(doc_id, include_content=False)  # Don't load content for list view
        if doc_meta:
            documents.append({
                'id': doc_id,
                'name': doc_meta['name'],
                'updated_at': doc_meta['updated_at'],
                'created_at': doc_meta['created_at']
            })
    return sorted(documents, key=lambda x: x['updated_at'], reverse=True)

def document_exists(doc_id):
    """Check if a document exists"""
    return os.path.exists(get_document_path(doc_id))

# ============================
# API Functions
# ============================

def is_openrouter_format(endpoint_or_model):
    """
    Check if the endpoint/model string is in OpenRouter format (provider/model-id)
    Returns True for OpenRouter format, False for URL format
    """
    # If it contains :// it's definitely a URL
    if '://' in endpoint_or_model:
        return False
    
    # If it contains a slash but no protocol, it's likely provider/model-id format
    if '/' in endpoint_or_model and not endpoint_or_model.startswith('http'):
        return True
    
    # If it's just a model name without slash, assume OpenRouter
    if '/' not in endpoint_or_model:
        return True
    
    # Default to OpenRouter format for anything else
    return True

def openai_compat_stream_generator(generation_id):
    """Generator function for OpenAI-compatible API streaming responses"""
    generation_data = active_generations[generation_id]
    prompt = generation_data['prompt']
    
    # Use the OpenAI endpoint from config
    base_url = config.get('openai_endpoint', 'http://localhost:8080/v1')
    endpoint_url = base_url
    
    headers = {
        'Content-Type': 'application/json'
    }
    
    # Add authorization if token is provided
    api_key = config.get('custom_api_key') or config.get('token')
    if api_key:
        headers['Authorization'] = f"Bearer {api_key}"
    
    # OpenAI-compatible payload format
    payload = {
        'model': config['model'],
        'prompt': prompt,
        'temperature': config['temperature'],
        'min_p': config['min_p'],
        'presence_penalty': config['presence_penalty'],
        'repetition_penalty': config['repetition_penalty'],  # Keep as repetition_penalty for OpenAI-compat
        'max_tokens': config['max_tokens'],
        'stream': True
    }
    
    try:
        # Normalize endpoint URL for OpenAI-compatible API
        if not endpoint_url.endswith('/completions'):
            if endpoint_url.endswith('/'):
                endpoint_url = endpoint_url + 'completions'
            else:
                endpoint_url = endpoint_url + '/completions'
        
        logger.info(f"Making OpenAI-compatible request to: {endpoint_url}")
        
        with requests.post(endpoint_url, headers=headers, json=payload, stream=True, timeout=30) as response:
            if response.status_code != 200:
                error_msg = f"OpenAI-compatible API error {response.status_code}"
                
                # Add specific status code descriptions
                if response.status_code == 404:
                    error_msg = "Error 404: Model or endpoint not found - Check your server URL and model configuration"
                elif response.status_code == 401:
                    error_msg = "Error 401: Authentication failed - Check your API token"
                elif response.status_code == 403:
                    error_msg = "Error 403: Access forbidden - Your token may not have permission for this model"
                elif response.status_code == 429:
                    error_msg = "Error 429: Rate limited - Too many requests, please wait and try again"
                elif response.status_code == 502:
                    error_msg = "Error 502: Server unavailable - The model server is down or overloaded"
                else:
                    try:
                        error_detail = response.json()
                        if 'error' in error_detail:
                            if isinstance(error_detail['error'], dict) and 'message' in error_detail['error']:
                                error_msg += f": {error_detail['error']['message']}"
                            else:
                                error_msg += f": {error_detail['error']}"
                    except:
                        pass
                
                logger.error(error_msg)
                yield "data: " + json.dumps({"error": error_msg}) + "\n\n"
                return
            
            buffer = ""
            for chunk in response.iter_content(chunk_size=1024, decode_unicode=False):
                if not generation_data['active']:
                    # Generation was cancelled
                    yield "data: " + json.dumps({"cancelled": True}) + "\n\n"
                    break
                
                if chunk:
                    buffer += chunk.decode('utf-8', errors='replace')
                    while True:
                        # Find the next complete SSE line
                        line_end = buffer.find('\n')
                        if line_end == -1:
                            break
                        
                        line = buffer[:line_end].strip()
                        buffer = buffer[line_end + 1:]
                        
                        if line.startswith('data: '):
                            data_str = line[6:]
                            if data_str == '[DONE]':
                                # Don't send done event yet - auto-rename check will handle it
                                break
                            
                            try:
                                data_obj = json.loads(data_str)
                                # OpenAI-compatible format: {"choices": [{"text": "..."}]} or {"content": "..."}
                                content = ""
                                if "choices" in data_obj and len(data_obj["choices"]) > 0:
                                    content = data_obj["choices"][0].get("text", "")
                                else:
                                    # Some servers might return direct content field
                                    content = data_obj.get("content", "")
                                
                                if content:
                                    yield "data: " + json.dumps({
                                        "text": content
                                    }) + "\n\n"
                            except json.JSONDecodeError:
                                pass
            
            # Check for auto-rename BEFORE sending done event
            generation_data = active_generations.get(generation_id)
            if generation_data and generation_data.get('document_id'):
                doc_id = generation_data['document_id']
                document = load_document(doc_id)
                if document and document.get('name') == 'Untitled' and document.get('content'):
                    # Auto-rename if document is still named "Untitled" and has content
                    try:
                        new_name = generate_document_name(document['content'])
                        if new_name and new_name != 'Untitled':
                            success, updated_doc = update_document_metadata(doc_id, new_name)
                            if success:
                                yield "data: " + json.dumps({"auto_renamed": True, "new_name": new_name}) + "\n\n"
                    except Exception as e:
                        logger.error(f"Error during auto-rename: {e}")
            
            if generation_id in active_generations:
                del active_generations[generation_id]
            
            yield "data: " + json.dumps({"done": True}) + "\n\n"
            
    except requests.exceptions.Timeout:
        error_msg = "OpenAI-compatible API timeout - server took too long to respond"
        logger.error(error_msg)
        yield "data: " + json.dumps({"error": error_msg}) + "\n\n"
        if generation_id in active_generations:
            del active_generations[generation_id]
    except requests.exceptions.ConnectionError as e:
        error_msg = "OpenAI-compatible API connection error - unable to connect to server"
        logger.error(f"{error_msg}: {str(e)} (URL: {endpoint_url})")
        yield "data: " + json.dumps({"error": error_msg}) + "\n\n"
        if generation_id in active_generations:
            del active_generations[generation_id]
    except Exception as e:
        error_msg = f"OpenAI-compatible API error: {str(e)}"
        logger.error(f"{error_msg} (URL: {endpoint_url})")
        yield "data: " + json.dumps({"error": error_msg}) + "\n\n"
        if generation_id in active_generations:
            del active_generations[generation_id]

def chutes_stream_generator(generation_id):
    """Generator function for Chutes API streaming responses"""
    generation_data = active_generations[generation_id]
    prompt = generation_data['prompt']
    
    # Hardcoded Chutes API endpoint
    endpoint_url = 'https://llm.chutes.ai/v1/completions'
    
    headers = {
        'Content-Type': 'application/json'
    }
    
    # Use custom API key if provided, otherwise fall back to main token
    api_key = config.get('custom_api_key') or config.get('token')
    if api_key:
        headers['Authorization'] = f"Bearer {api_key}"
    
    # Chutes API payload format (similar to OpenAI but with model as HF name)
    payload = {
        'model': config['model'],  # HF model name like "microsoft/DialoGPT-medium"
        'prompt': prompt,
        'temperature': config['temperature'],
        'min_p': config['min_p'],
        'presence_penalty': config['presence_penalty'],
        'repetition_penalty': config['repetition_penalty'],
        'max_tokens': config['max_tokens'],
        'stream': True
    }
    
    try:
        logger.info(f"Making Chutes API request to: {endpoint_url}")
        
        with requests.post(endpoint_url, headers=headers, json=payload, stream=True, timeout=30) as response:
            if response.status_code != 200:
                error_msg = f"Chutes API error {response.status_code}"
                
                # Add specific status code descriptions
                if response.status_code == 404:
                    error_msg = "Error 404: Model not found - Check your model name for Chutes API"
                elif response.status_code == 401:
                    error_msg = "Error 401: Authentication failed - Check your Chutes API token"
                elif response.status_code == 403:
                    error_msg = "Error 403: Access forbidden - Your token may not have permission for this model"
                elif response.status_code == 429:
                    error_msg = "Error 429: Rate limited - Too many requests, please wait and try again"
                elif response.status_code == 502:
                    error_msg = "Error 502: Server unavailable - The Chutes API server is down or overloaded"
                else:
                    try:
                        error_detail = response.json()
                        if 'error' in error_detail:
                            if isinstance(error_detail['error'], dict) and 'message' in error_detail['error']:
                                error_msg += f": {error_detail['error']['message']}"
                            else:
                                error_msg += f": {error_detail['error']}"
                    except:
                        pass
                
                logger.error(error_msg)
                yield "data: " + json.dumps({"error": error_msg}) + "\n\n"
                return
            
            buffer = ""
            for chunk in response.iter_content(chunk_size=1024, decode_unicode=False):
                if not generation_data['active']:
                    # Generation was cancelled
                    yield "data: " + json.dumps({"cancelled": True}) + "\n\n"
                    break
                
                if chunk:
                    buffer += chunk.decode('utf-8', errors='replace')
                    while True:
                        # Find the next complete SSE line
                        line_end = buffer.find('\n')
                        if line_end == -1:
                            break
                        
                        line = buffer[:line_end].strip()
                        buffer = buffer[line_end + 1:]
                        
                        if line.startswith('data: '):
                            data_str = line[6:]
                            if data_str == '[DONE]':
                                # Don't send done event yet - auto-rename check will handle it
                                break
                            
                            try:
                                data_obj = json.loads(data_str)
                                # Chutes API format: {"choices": [{"text": "..."}]} or {"content": "..."}
                                content = ""
                                if "choices" in data_obj and len(data_obj["choices"]) > 0:
                                    content = data_obj["choices"][0].get("text", "")
                                else:
                                    # Some servers might return direct content field
                                    content = data_obj.get("content", "")
                                
                                if content:
                                    yield "data: " + json.dumps({
                                        "text": content
                                    }) + "\n\n"
                            except json.JSONDecodeError:
                                pass
            
            # Check for auto-rename BEFORE sending done event
            generation_data = active_generations.get(generation_id)
            if generation_data and generation_data.get('document_id'):
                doc_id = generation_data['document_id']
                document = load_document(doc_id)
                if document and document.get('name') == 'Untitled' and document.get('content'):
                    # Auto-rename if document is still named "Untitled" and has content
                    try:
                        new_name = generate_document_name(document['content'])
                        if new_name and new_name != 'Untitled':
                            success, updated_doc = update_document_metadata(doc_id, new_name)
                            if success:
                                yield "data: " + json.dumps({"auto_renamed": True, "new_name": new_name}) + "\n\n"
                    except Exception as e:
                        logger.error(f"Error during auto-rename: {e}")
            
            if generation_id in active_generations:
                del active_generations[generation_id]
            
            yield "data: " + json.dumps({"done": True}) + "\n\n"
            
    except requests.exceptions.Timeout:
        error_msg = "Chutes API timeout - server took too long to respond"
        logger.error(error_msg)
        yield "data: " + json.dumps({"error": error_msg}) + "\n\n"
        if generation_id in active_generations:
            del active_generations[generation_id]
    except requests.exceptions.ConnectionError as e:
        error_msg = "Chutes API connection error - unable to connect to server"
        logger.error(f"{error_msg}: {str(e)} (URL: {endpoint_url})")
        yield "data: " + json.dumps({"error": error_msg}) + "\n\n"
        if generation_id in active_generations:
            del active_generations[generation_id]
    except Exception as e:
        error_msg = f"Chutes API error: {str(e)}"
        logger.error(f"{error_msg} (URL: {endpoint_url})")
        yield "data: " + json.dumps({"error": error_msg}) + "\n\n"
        if generation_id in active_generations:
            del active_generations[generation_id]

def generate_text(prompt, model_params):
    """Generate text via OpenRouter API (non-streaming)"""
    headers = {
        'Authorization': f"Bearer {model_params['token']}",
        'Content-Type': 'application/json'
    }
    
    payload = {
        'model': model_params['model'],
        'prompt': prompt,
        'temperature': model_params['temperature'],
        'min_p': model_params['min_p'],
        'presence_penalty': model_params['presence_penalty'],
        'repetition_penalty': model_params['repetition_penalty'],
        'max_tokens': model_params['max_tokens'],
        'stream': False
    }
    
    try:
        response = requests.post(model_params['endpoint'], headers=headers, json=payload)
        if response.status_code == 200:
            return response.json()
        else:
            logger.error(f"API error: {response.status_code}")
            return None
    except Exception as e:
        logger.error(f"Error generating text: {e}")
        return None

def generate_document_name(content):
    """Generate a 2-4 word document name based on content using AI"""
    # Truncate content to reasonable length for naming
    max_chars = 2000  # Approximately 500-750 tokens
    if len(content) > max_chars:
        content = content[:max_chars]
    
    prompt = f"""Based on this text content, generate a short, descriptive document name that is 2-4 words long. The name should capture the main theme, setting, or key elements of the text.

Text content:
{content}

Respond with ONLY the document name, nothing else. Example formats:
- "Lighthouse Mystery"
- "Ocean Storm Night" 
- "Ancient Forest Discovery"
- "Desert Caravan Journey"

Document name:"""
    
    try:
        headers = {
            'Authorization': f"Bearer {config['token']}",
            'Content-Type': 'application/json'
        }
        
        payload = {
            'model': 'moonshotai/kimi-k2:free',  # Use specified model for renaming
            'prompt': prompt,
            'temperature': 0.3,  # Lower temperature for more focused responses
            'max_tokens': 10,    # Shorter to avoid long responses
            'stream': False
        }
        
        response = requests.post('https://openrouter.ai/api/v1/completions', headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            data = response.json()
            name = data.get("choices", [{}])[0].get("text", "").strip()
            # Clean up response - remove quotes, extra whitespace, newlines
            name = name.strip().strip('"').strip("'").strip()
            # Take only the first line if there are multiple lines
            name = name.split('\n')[0].strip()
            # Ensure it's reasonable length (2-4 words, roughly 20-50 chars)
            if len(name) > 50:
                name = name[:50].rsplit(' ', 1)[0]  # Cut at word boundary
            return name if name else "Untitled"
        else:
            logger.error(f"Error generating document name: {response.status_code}")
            return "Untitled"
    except Exception as e:
        logger.error(f"Error generating document name: {e}")
        return "Untitled"

def stream_generator(generation_id):
    """Generator function for streaming API responses"""
    generation_data = active_generations[generation_id]
    prompt = generation_data['prompt']
    
    
    headers = {
        'Authorization': f"Bearer {config['token']}",
        'Content-Type': 'application/json'
    }
    
    # Primary model configuration
    payload = {
        'model': config['model'],
        'prompt': prompt,
        'temperature': config['temperature'],
        'min_p': config['min_p'],
        'presence_penalty': config['presence_penalty'],
        'repetition_penalty': config['repetition_penalty'],
        'max_tokens': config['max_tokens'],
        'stream': True
    }
    
    try:
        with requests.post(config['endpoint'], headers=headers, json=payload, stream=True) as response:
            # If primary model fails with a 4xx error, try the first fallback model
            if response.status_code >= 400 and response.status_code < 500:
                # Add specific error messages for common status codes before trying fallbacks
                if response.status_code == 404:
                    yield "data: " + json.dumps({"error": "Error 404: Model not found - Check your model name in settings"}) + "\n\n"
                    return
                elif response.status_code == 401:
                    yield "data: " + json.dumps({"error": "Error 401: Invalid API token - Please check your OpenRouter token"}) + "\n\n"
                    return
                elif response.status_code == 402:
                    yield "data: " + json.dumps({"error": "Error 402: Insufficient credits - Add more credits to your OpenRouter account"}) + "\n\n"
                    return
                elif response.status_code == 403:
                    yield "data: " + json.dumps({"error": "Error 403: Content blocked - Your prompt was flagged by content moderation"}) + "\n\n"
                    return
                elif response.status_code == 429:
                    yield "data: " + json.dumps({"error": "Error 429: Rate limited - Please wait a moment and try again"}) + "\n\n"
                    return
                
                logger.info(f"Primary model failed with status {response.status_code}, trying first fallback model")
                
                # First fallback model configuration (405b)
                fallback_payload = payload.copy()
                fallback_payload['model'] = 'meta-llama/llama-3.1-405b'
                
                with requests.post(config['endpoint'], headers=headers, json=fallback_payload, stream=True) as fallback_response:
                    if fallback_response.status_code >= 400 and fallback_response.status_code < 500:
                        logger.info(f"First fallback model failed with status {fallback_response.status_code}, trying second fallback model")
                        
                        # Second fallback model configuration (70b)
                        second_fallback_payload = payload.copy()
                        second_fallback_payload['model'] = 'meta-llama/llama-3-70b'
                        
                        with requests.post(config['endpoint'], headers=headers, json=second_fallback_payload, stream=True) as second_fallback_response:
                            if second_fallback_response.status_code != 200:
                                yield "data: " + json.dumps({"error": f"All models failed. Status codes: {response.status_code}, {fallback_response.status_code}, {second_fallback_response.status_code}"}) + "\n\n"
                                return
                            
                            # Process the second fallback model response
                            response = second_fallback_response
                    elif fallback_response.status_code != 200:
                        yield "data: " + json.dumps({"error": f"API error: {fallback_response.status_code}"}) + "\n\n"
                        return
                    else:
                        # Process the first fallback model response
                        response = fallback_response
            elif response.status_code != 200:
                yield "data: " + json.dumps({"error": f"API error: {response.status_code}"}) + "\n\n"
                return
            
            buffer = ""
            for chunk in response.iter_content(chunk_size=1024, decode_unicode=False):
                if not generation_data['active']:
                    # Generation was cancelled
                    yield "data: " + json.dumps({"cancelled": True}) + "\n\n"
                    break
                
                if chunk:
                    buffer += chunk.decode('utf-8', errors='replace')
                    while True:
                        # Find the next complete SSE line
                        line_end = buffer.find('\n')
                        if line_end == -1:
                            break
                        
                        line = buffer[:line_end].strip()
                        buffer = buffer[line_end + 1:]
                        
                        if line.startswith('data: '):
                            data_str = line[6:]
                            if data_str == '[DONE]':
                                # Don't send done event yet - auto-rename check will handle it
                                break
                            
                            try:
                                data_obj = json.loads(data_str)
                                content = data_obj.get("choices", [{}])[0].get("text", "")
                                if content:
                                    yield "data: " + json.dumps({
                                        "text": content
                                    }) + "\n\n"
                            except json.JSONDecodeError:
                                pass
            
            # Check for auto-rename BEFORE sending done event
            generation_data = active_generations.get(generation_id)
            if generation_data and generation_data.get('document_id'):
                doc_id = generation_data['document_id']
                document = load_document(doc_id)
                if document and document.get('name') == 'Untitled' and document.get('content'):
                    # Auto-rename if document is still named "Untitled" and has content
                    try:
                        new_name = generate_document_name(document['content'])
                        if new_name and new_name != 'Untitled':
                            success, updated_doc = update_document_metadata(doc_id, new_name)
                            if success:
                                yield "data: " + json.dumps({"auto_renamed": True, "new_name": new_name}) + "\n\n"
                    except Exception as e:
                        logger.error(f"Error during auto-rename: {e}")
            
            # Clean up and send done event
            if generation_id in active_generations:
                del active_generations[generation_id]
            
            yield "data: " + json.dumps({"done": True}) + "\n\n"
    except Exception as e:
        logger.error(f"Error in stream generation: {e}")
        yield "data: " + json.dumps({"error": str(e)}) + "\n\n"
        if generation_id in active_generations:
            del active_generations[generation_id]

# ============================
# Routes
# ============================

@app.route('/')
def index():
    """Render the main application page"""
    token_set = bool(config['token'])
    logger.info(f"Token set status: {token_set}")
    return render_template('index.html', token_set=token_set, config=config)

@app.route('/set_token', methods=['POST'])
def set_token():
    """Set the API token"""
    token = request.form.get('token')
    if not token:
        logger.warning("No token provided in request")
        return jsonify({'success': False, 'error': 'No token provided'})
    
    logger.info("Setting new token")
    config['token'] = token
    if save_config(config):
        logger.info("Token saved successfully")
        return jsonify({'success': True})
    else:
        logger.error("Failed to save token")
        return jsonify({'success': False, 'error': 'Failed to save token'})

@app.route('/settings', methods=['GET', 'POST'])
def settings():
    """Get or update application settings"""
    if request.method == 'POST':
        # Update settings
        config['model'] = request.form.get('model', config['model'])
        config['temperature'] = float(request.form.get('temperature', config['temperature']))
        config['min_p'] = float(request.form.get('min_p', config['min_p']))
        config['presence_penalty'] = float(request.form.get('presence_penalty', config['presence_penalty']))
        config['repetition_penalty'] = float(request.form.get('repetition_penalty', config['repetition_penalty']))
        config['max_tokens'] = int(request.form.get('max_tokens', config['max_tokens']))
        config['dark_mode'] = request.form.get('dark_mode') == 'on'  # Convert checkbox value to boolean
        config['provider'] = request.form.get('provider', config.get('provider', 'openrouter'))
        config['custom_api_key'] = request.form.get('custom_api_key', config.get('custom_api_key', ''))
        config['openai_endpoint'] = request.form.get('openai_endpoint', config.get('openai_endpoint', 'http://localhost:8080/v1'))
        config['embeddings_search'] = request.form.get('embeddings_search') == 'on'
        save_config(config)
        return jsonify({'success': True})
    
    return render_template('settings.html', config=config)

@app.route('/documents', methods=['GET'])
def get_documents():
    """Get list of all documents"""
    documents = get_all_documents()
    return jsonify({
        'success': True,
        'documents': documents,
        'current_document': config['current_document']
    })

@app.route('/documents/search', methods=['GET'])
def search_documents():
    """Search documents by keyword or embeddings similarity"""
    query = request.args.get('q', '').strip()
    use_embeddings = config.get('embeddings_search', True)
    
    if not query:
        # Return all documents if no query
        documents = get_all_documents()
        return jsonify({
            'success': True,
            'documents': documents,
            'query': query,
            'search_type': 'none'
        })
    
    matching_documents = []
    
    if use_embeddings:
        # Embeddings search only
        query_embedding = calculate_text_embedding(query)
        logger.info(f"Query embedding calculated: {query_embedding is not None}")
        
        for doc_id in config['documents']:
            doc_meta = get_document_metadata(doc_id)
            if doc_meta:
                similarity_score = 0.0
                if query_embedding:
                    content_embedding = doc_meta.get('content_embedding')
                    name_embedding = doc_meta.get('name_embedding')
                    
                    # Check similarity with content
                    content_similarity = 0.0
                    if content_embedding:
                        content_similarity = cosine_similarity(query_embedding, content_embedding)
                    
                    # Check similarity with name
                    name_similarity = 0.0
                    if name_embedding:
                        name_similarity = cosine_similarity(query_embedding, name_embedding)
                    
                    # Use the higher of the two similarities
                    similarity_score = max(content_similarity, name_similarity)
                    
                    logger.info(f"Doc {doc_meta.get('name', 'Untitled')[:20]}: content_sim={content_similarity:.3f}, name_sim={name_similarity:.3f}, max={similarity_score:.3f}")
                
                # Include all documents with their similarity scores
                matching_documents.append({
                    'id': doc_id,
                    'name': doc_meta.get('name', 'Untitled'),
                    'updated_at': doc_meta.get('updated_at'),
                    'created_at': doc_meta.get('created_at'),
                    'similarity_score': similarity_score
                })
        
        # Sort by similarity score (highest first)
        matching_documents.sort(key=lambda x: x['similarity_score'], reverse=True)
        search_type = 'embeddings'
        
    else:
        # Keyword search only
        query_lower = query.lower()
        for doc_id in config['documents']:
            doc_meta = get_document_metadata(doc_id)
            if doc_meta:
                # Count occurrences in content and name (case-insensitive)
                content = doc_meta.get('content', '').lower()
                name = doc_meta.get('name', '').lower()
                
                content_count = content.count(query_lower)
                name_count = name.count(query_lower)
                total_occurrences = content_count + name_count
                
                # Include all documents with their occurrence counts
                matching_documents.append({
                    'id': doc_id,
                    'name': doc_meta.get('name', 'Untitled'),
                    'updated_at': doc_meta.get('updated_at'),
                    'created_at': doc_meta.get('created_at'),
                    'occurrence_count': total_occurrences
                })
        
        # Sort by occurrence count (highest first), then by updated_at
        matching_documents.sort(key=lambda x: (x['occurrence_count'], x['updated_at']), reverse=True)
        search_type = 'keyword'
    
    return jsonify({
        'success': True,
        'documents': matching_documents,
        'query': query,
        'search_type': search_type,
        'total_matches': len(matching_documents)
    })


@app.route('/documents/new', methods=['POST'])
def new_document():
    """Create a new document"""
    name = request.form.get('name', 'Untitled')
    doc_id, document = create_new_document(name)
    
    if doc_id:
        return jsonify({
            'success': True,
            'document': document
        })
    else:
        return jsonify({
            'success': False,
            'error': 'Failed to create document'
        })

@app.route('/documents/<doc_id>', methods=['GET'])
def get_document(doc_id):
    """Get a specific document by ID"""
    document = load_document(doc_id)
    if document:
        return jsonify({
            'success': True,
            'document': document
        })
    
    return jsonify({
        'success': False,
        'error': 'Document not found'
    })

@app.route('/documents/<doc_id>/set-current', methods=['POST'])
def set_current_document(doc_id):
    """Set the currently active document"""
    if doc_id in config['documents']:
        config['current_document'] = doc_id
        save_config(config)
        return jsonify({'success': True})
    
    return jsonify({
        'success': False,
        'error': 'Document not found'
    })

@app.route('/documents/<doc_id>', methods=['PUT'])
def update_document(doc_id):
    """Update an existing document"""
    if doc_id not in config['documents']:
        return jsonify({
            'success': False,
            'error': 'Document not found'
        })
    
    data = request.json
    if not data:
        return jsonify({
            'success': False,
            'error': 'No data provided'
        })
    
    # Handle different update types
    if 'content' in data:
        # Content update
        success, document = update_document_content(doc_id, data['content'])
    elif 'name' in data:
        # Metadata update
        success, document = update_document_metadata(doc_id, data['name'])
    else:
        return jsonify({
            'success': False,
            'error': 'Invalid update data'
        })
    
    if success:
        return jsonify({
            'success': True,
            'document': document
        })
    
    return jsonify({
        'success': False,
        'error': 'Failed to update document'
    })

@app.route('/documents/<doc_id>', methods=['DELETE'])
def remove_document(doc_id):
    """Delete a document"""
    if doc_id not in config['documents']:
        return jsonify({
            'success': False,
            'error': 'Document not found'
        })
    
    # Delete document file
    if delete_document(doc_id):
        return jsonify({'success': True})
    
    return jsonify({
        'success': False,
        'error': 'Failed to delete document'
    })

@app.route('/submit', methods=['POST'])
def submit():
    """Submit a prompt for text generation"""
    prompt = request.form.get('prompt', '')
    doc_id = request.form.get('document_id')
    
    if not prompt or not config['token']:
        return jsonify({'success': False, 'error': 'No prompt or token provided'})
    
    # Generate a unique ID for this request
    generation_id = str(uuid.uuid4())
    
    # Store the prompt and additional data for streaming
    active_generations[generation_id] = {
        'prompt': prompt,
        'document_id': doc_id,
        'active': True
    }
    
    return jsonify({'success': True, 'generation_id': generation_id})

@app.route('/cancel/<generation_id>', methods=['POST'])
def cancel(generation_id):
    """Cancel an in-progress generation"""
    if generation_id in active_generations:
        active_generations[generation_id]['active'] = False
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': 'Generation not found'})

@app.route('/stream/<generation_id>')
def stream(generation_id):
    """Stream a text generation response"""
    if generation_id not in active_generations:
        return Response("data: " + json.dumps({"error": "Generation not found"}) + "\n\n", 
                       mimetype="text/event-stream")
    
    # Determine which backend to use based on provider setting
    provider = config.get('provider', 'openrouter')
    
    if provider == 'chutes':
        generator = chutes_stream_generator(generation_id)
    elif provider == 'openai':
        generator = openai_compat_stream_generator(generation_id)
    elif provider == 'openrouter':
        generator = stream_generator(generation_id)
    else:
        # Fallback to old logic for backwards compatibility
        if is_openrouter_format(config['model']):
            generator = stream_generator(generation_id)
        else:
            generator = openai_compat_stream_generator(generation_id)
    
    response = Response(generator, mimetype="text/event-stream")
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    return response

# ============================
# Main Entry Point
# ============================

if __name__ == '__main__':
    app.run(debug=True)

# Load all documents into cache at startup
def init_documents_cache():
    """Initialize the documents cache with all documents from disk"""
    for doc_id in config['documents']:
        doc_path = get_document_path(doc_id)
        if os.path.exists(doc_path):
            try:
                with open(doc_path, 'r') as f:
                    document = json.load(f)
                    documents_cache[doc_id] = document
                    logger.info(f"Document {doc_id} loaded into cache")
            except Exception as e:
                logger.error(f"Error loading document {doc_id} into cache: {e}")

# Initialize cache at startup
init_documents_cache()

# Ensure writes are flushed on shutdown
import atexit

@atexit.register
def cleanup():
    """Ensure all documents are written to disk on shutdown"""
    if write_timer:
        write_timer.cancel()
    write_documents_to_disk()