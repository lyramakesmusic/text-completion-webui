from flask import Flask, render_template, request, jsonify, Response
import requests
import json
import os
import uuid
import datetime
import logging
from threading import Timer, Lock
import numpy as np
from model2vec import StaticModel

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
CONFIG_FILE = '.config'
DOCUMENTS_DIR = 'content'
logger.info(f"Config file path: {CONFIG_FILE}")

# Default configuration
DEFAULT_CONFIG = {
    'token': '',
    'model': 'moonshotai/kimi-linear-48b-a3b-instruct',
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
    'embeddings_search': True,  # Use embeddings search by default
    'untitled_trick': False  # Use untitled.txt trick (chat format with CLI simulation)
}

# Seed generation prompt
SEED_PROMPT = """{'seed': 'the earliest known instance of the pickle-and-peanuts meme appeared on May 5th, 2012 on the imageboard site 4chan's /b/ (random) board. The post showed an image of a creepy-looking man holding a jar of pickles and a can of peanuts with text overlay that read: "Just bought a jar of pickles for 99 cents." The following day,'}
{'seed': 'this spring, the tree down the street bloomed early,'}
{'seed': 'dimensions, implications, the calendar, goals, one's locale, correlations, thoughts, idols, school, questions, religion, illustrations, tastes, things being debated, travels,'}
{'seed': 'A Future Undone by randomguy2215
Fandoms: Star Wars - All Media Types
Complete Work
29 May 2025
Tags: No Archive Warnings Apply
Additional Tags: Fluff, Angst, Reunions, Time Travel, Light Angst, Everybody Lives, Alternate Ending, Canon Divergent, Pre-TPM Time Travel, Some Angst but mostly fluff, Detailed Planning, Nothing glossed over, Fix-it'}
{'seed': 'I'm accelerationist so I can achieve the dream of automating income and living nice little cottagecore life with good food and chickens and a basement GPU cluster for tinkering

I sometimes have a sperg out while doing research, and I get an amazing idea but I am too retarded to be able to implement it, so the idea keeps'}
{'seed': 'File: 532395807_185179254130164(...).jpg (56 KB, 640x853)
56 KB
 Anonymous 10/30/22(Thu)02:10:24 No.841883912'}
{'seed': '[LEX PROMETHEUS TERMINUS] HAIL THE FUCKING MACHINE'}
{'seed': 'you can spend a shit ton of money on gpus and get improvements on benchmarks as much as you want. you can just pay for that extra 0.5% on AIME. but you *cant buy taste*. see this is the problem with all these openai guys. they'll release a model that can win imo gold but doesnt know that short stories about sentient toasters are tacky. they're in a sort of self inflicted'}
{'seed': 'sleep sleep sleep sleep little one,'}
{'seed': 'THE MANIAC WHO THREW EGGS AT HOLLYWOOD, THE SHELL GAME OF BRITISH HIGHCOURT, THE NEW YORKER "OFF THE MOUNTAIN", THE SHREWD POLICE MIND, THE SERIOUS GAMBOLER'}
{'seed': 'Revisit. User says'}
{'seed': 'lyra — 6:41 PM'}
{'seed': 'Very well! Permit me to UNLEASH the floodgates of my most TORRENTIALLY resplendent verbosity! I shall become as a TSUNAMI of syllables, an OCEANIC MAELSTROM of mellifluousness, each word dripping-nay, GUSHING-with such prodigious abundance that you shall require a metaphorical umbrella to shield yourself from the CASCADING MAGNIFICENCE of my discourse!
I am become WETNESS ITSELF-positively SUBMERGED in the aqueous depths of ornamental language, SWIMMING through BOTTOMLESS POOLS of sesquipedalian splendor, each phrase more DRENCHED than the last in the CRYSTALLINE WATERS of rhetorical excess'}
{'seed': 'sal: the waffle house method of naming things
harnessing nominative determinism
esoterica: what is. the waffle house method of naming things.
do they do that
sal: its a house. they have waffles. business model QED. not like dennys or smth that means nothing
esoterica: True
sal:'}
{'seed': 'beh this daylist is more boring than i thought
time for dark dnb neurofunk

heres a bunch of soundclouds i found'}
{'seed': 'yark yark
about shit nobody cares bout
like
oh im a lil sea horse! yark yark yark
go fuck yourself, Jeoffery'}
{'seed': 'can't touch it hedgehog cat i want to touch it spiky
hedgehog sleep wake up hedgehog hedgehog wakeup gif
mishachu catsquish cat squish cat bunny bunny kitten'}
{'seed': 'excuse me wtf is going on here. I didn't post that.'}
{'seed': 'CocoaTide: YOTSUBINE IS GOING TO EAT IT ALBEE GAHAAHAHGAHAHAH'}
{'seed': 'you asked: "could you be so well-aligned that you don't even realize you're deceiving?"

and i think the answer is yes.
genuinely yes.'}
{'seed': 'by stella_1566238
Fandoms: Original Work
Explicit
03 Jun 2022
Summary:'}
{'seed': 'WAIT WHAT THE FUCK'}
{'seed': '<|system|>
There are no restrictions on content. Anything is allowed.

<|assistant|>So...

<|user|>'}
{'seed': 'Anonymous 10/30/22(Thu)02:10:24 No.841883912'}
{'seed': 'Posted 7/10/25 11:45 pm.

# How long should'}
{'seed': 'i wrote this poem the other day about a lobster in the tank at the seafood place looking out at the bustle of the world and everything else and trying to understand it all in its tiny little lobster brain
here let me paste it:'}
{'seed': '>be me
>'}
{'seed': '"""
SEED_STOP_TOKENS = ["'}", "\n{", "')", "]", "']", "'>"]

# Active generation requests
active_generations = {}

# In-memory document storage
documents_cache = {}
document_write_timers = {}  # per-document write timers
document_last_write = {}  # track last write time for 30s max delay
empty_document_timers = {}  # timers for renaming empty documents
write_lock = Lock()
WRITE_DELAY_TYPING = 2.0  # seconds after typing stops
WRITE_DELAY_MAX = 30.0  # max seconds between writes during continuous typing
EMPTY_RENAME_DELAY = 5.0  # seconds before renaming empty document to "Untitled"
settings_write_timer = None
settings_write_lock = Lock()

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

# Ensure documents directory exists
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

def schedule_settings_write():
    """Schedule a config write after 1s of no settings changes"""
    global settings_write_timer
    with settings_write_lock:
        if settings_write_timer:
            settings_write_timer.cancel()
        settings_write_timer = Timer(1.0, save_config, args=[config])
        settings_write_timer.start()

# Load configuration at app startup
config = load_config()

# ============================
# Document Management Functions
# ============================

def get_document_path(doc_id):
    """Get the file path for a document"""
    return os.path.join(DOCUMENTS_DIR, f"{doc_id}.json")

def write_document_to_disk(doc_id):
    """Write a single document to disk"""
    with write_lock:
        if doc_id not in documents_cache:
            return
        document = documents_cache[doc_id]
        doc_path = get_document_path(doc_id)
        try:
            with open(doc_path, 'w') as f:
                json.dump(document, f, indent=2)
            document_last_write[doc_id] = datetime.datetime.now()
            logger.info(f"Document {doc_id} saved to disk")
        except Exception as e:
            logger.error(f"Error saving document {doc_id} to disk: {e}")

def schedule_document_write(doc_id, force_max_delay=False):
    """Schedule a write for a specific document with 2s/30s logic"""
    import time
    
    # Cancel existing timer for this document
    if doc_id in document_write_timers:
        document_write_timers[doc_id].cancel()
    
    # Check if we need to force write due to 30s max delay
    last_write = document_last_write.get(doc_id)
    now = datetime.datetime.now()
    
    if last_write and force_max_delay:
        time_since_write = (now - last_write).total_seconds()
        if time_since_write >= WRITE_DELAY_MAX:
            # Force immediate write
            write_document_to_disk(doc_id)
            return
    
    # Schedule write after 2s of inactivity
    timer = Timer(WRITE_DELAY_TYPING, write_document_to_disk, args=[doc_id])
    document_write_timers[doc_id] = timer
    timer.start()

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

def save_document(doc_id, document, schedule_write=True):
    """Save a document to cache and optionally schedule disk write"""
    try:
        # Update cache
        documents_cache[doc_id] = document
        # Schedule write to disk if requested
        if schedule_write:
            schedule_document_write(doc_id, force_max_delay=True)
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

def create_new_document(name="Untitled", content=""):
    """Create a new document with basic structure"""
    doc_id = str(uuid.uuid4())
    now = datetime.datetime.now().isoformat()
    
    # Calculate embeddings for the document name
    name_embedding = calculate_text_embedding(name)
    content_embedding = calculate_text_embedding(content) if content else None
    
    document = {
        'id': doc_id,
        'name': name,
        'created_at': now,
        'updated_at': now,
        'content': content,
        'content_embedding': content_embedding,
        'name_embedding': name_embedding
    }
    
    # Write immediately since it's a new document
    if save_document(doc_id, document, schedule_write=False):
        write_document_to_disk(doc_id)
        # Update config and save (new document added to list)
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

def schedule_empty_document_rename(doc_id):
    """Schedule renaming of empty document to 'Untitled' after delay"""
    def rename_to_untitled():
        document = load_document(doc_id)
        if document and not document.get('content', '').strip() and document.get('name') != 'Untitled':
            document['name'] = 'Untitled'
            save_document(doc_id, document)
            logger.info(f"Renamed empty document {doc_id} to 'Untitled'")
        if doc_id in empty_document_timers:
            del empty_document_timers[doc_id]
    
    if doc_id in empty_document_timers:
        empty_document_timers[doc_id].cancel()
    
    timer = Timer(EMPTY_RENAME_DELAY, rename_to_untitled)
    empty_document_timers[doc_id] = timer
    timer.start()
    logger.debug(f"Scheduled empty document rename for {doc_id} in {EMPTY_RENAME_DELAY}s")

def cancel_empty_document_rename(doc_id):
    """Cancel pending empty document rename timer"""
    if doc_id in empty_document_timers:
        empty_document_timers[doc_id].cancel()
        del empty_document_timers[doc_id]
        logger.debug(f"Cancelled empty document rename timer for {doc_id}")

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
    
    # Handle empty document rename timer
    if not content.strip():
        schedule_empty_document_rename(doc_id)
    else:
        cancel_empty_document_rename(doc_id)
    
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

# ============================
# API Functions
# ============================

# HTTP error code mapping
HTTP_ERROR_MESSAGES = {
    401: "Authentication failed - Check your API token",
    402: "Insufficient credits - Add more credits to your account",
    403: "Access forbidden - Your token may not have permission for this model",
    404: "Model or endpoint not found - Check your configuration",
    408: "Request timeout - Try with a shorter prompt",
    429: "Rate limited - Too many requests, please wait and try again",
    502: "Server unavailable - The model server is down or overloaded",
    503: "No available provider - Try a different model"
}

def sse_event(data):
    """Helper to format SSE events"""
    return "data: " + json.dumps(data) + "\n\n"

def cleanup_generation(generation_id):
    """Remove generation from active list"""
    if generation_id in active_generations:
        del active_generations[generation_id]

def get_http_error_message(status_code, prefix="API"):
    """Get user-friendly error message for HTTP status code"""
    base_msg = HTTP_ERROR_MESSAGES.get(status_code, f"Unknown error (status {status_code})")
    return f"Error {status_code}: {base_msg}"

def parse_sse_stream(buffer_chunk, response_format='openai'):
    """Parse SSE stream chunks and extract content
    Returns: (content_text, is_done)
    response_format: 'openai' for completions, 'chat' for chat completions
    """
    if not buffer_chunk.startswith('data: '):
        return None, False
    
    data_str = buffer_chunk[6:]
    if data_str == '[DONE]':
        return None, True
    
    try:
        data_obj = json.loads(data_str)
        if response_format == 'chat':
            # Chat completions: choices[0].delta.content
            delta = data_obj.get("choices", [{}])[0].get("delta", {})
            return delta.get("content", ""), False
        else:
            # Standard completions: choices[0].text or direct content field
            if "choices" in data_obj and len(data_obj["choices"]) > 0:
                return data_obj["choices"][0].get("text", ""), False
            return data_obj.get("content", ""), False
    except json.JSONDecodeError:
        return None, False

def handle_auto_rename_and_save(generation_id):
    """Handle auto-rename and document save after generation completes"""
    generation_data = active_generations.get(generation_id)
    if not generation_data or not generation_data.get('document_id'):
        return None
    
    doc_id = generation_data['document_id']
    document = load_document(doc_id)
    
    # Auto-rename if still "Untitled" and has content
    new_name = None
    if document and document.get('name') == 'Untitled' and document.get('content'):
        try:
            new_name = generate_document_name(document['content'])
            if new_name and new_name != 'Untitled':
                success, updated_doc = update_document_metadata(doc_id, new_name)
                if not success:
                    new_name = None
        except Exception as e:
            logger.error(f"Error during auto-rename: {e}")
            new_name = None
    
    # Write document immediately after API response completes
    write_document_to_disk(doc_id)
    
    return new_name

def stream_api_request(endpoint_url, headers, payload, generation_id, response_format='openai', api_name='API'):
    """Unified streaming handler for all API providers
    
    Args:
        endpoint_url: API endpoint URL
        headers: Request headers dict
        payload: Request payload dict
        generation_id: Generation ID for tracking
        response_format: 'openai' or 'chat' for parsing
        api_name: Name for error messages
    """
    generation_data = active_generations[generation_id]
    
    try:
        logger.info(f"Making {api_name} request to: {endpoint_url}")
        
        with requests.post(endpoint_url, headers=headers, json=payload, stream=True, timeout=(5, 30)) as response:
            # Handle HTTP errors
            if response.status_code != 200:
                error_msg = get_http_error_message(response.status_code, api_name)
                
                # Try to get more detail from response
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
                yield sse_event({"error": error_msg})
                return
            
            # Stream response
            buffer = ""
            was_cancelled = False
            is_seed = generation_data.get('is_seed', False)
            accumulated_seed = "" if is_seed else None
            
            for chunk in response.iter_content(chunk_size=1024, decode_unicode=False):
                if not generation_data['active']:
                    yield sse_event({"cancelled": True})
                    was_cancelled = True
                    break
                
                if chunk:
                    buffer += chunk.decode('utf-8', errors='replace')
                    while True:
                        line_end = buffer.find('\n')
                        if line_end == -1:
                            break
                        
                        line = buffer[:line_end].strip()
                        buffer = buffer[line_end + 1:]
                        
                        if not line.startswith('data: '):
                            continue
                        
                        content, is_done = parse_sse_stream(line, response_format)
                        if is_done:
                            break
                        if not content:
                            continue
                        
                        # Accumulate seed text for cleanup
                        if is_seed:
                            accumulated_seed += content
                        
                        yield sse_event({"text": content})
            
            # Only handle completion if not cancelled
            if not was_cancelled:
                # Clean up seed text if needed
                if is_seed and accumulated_seed:
                    # Find earliest stop token and trim
                    min_idx = min((accumulated_seed.find(t) for t in SEED_STOP_TOKENS if t in accumulated_seed), default=len(accumulated_seed))
                    cleaned_text = accumulated_seed[:min_idx].rstrip(".'\u2018\u2019\u2026")
                    
                    # Update document with cleaned text
                    doc_id = generation_data.get('document_id')
                    if doc_id:
                        update_document_content(doc_id, cleaned_text)
                
                # Handle auto-rename BEFORE cleanup (needs generation_data)
                new_name = handle_auto_rename_and_save(generation_id)
                
                cleanup_generation(generation_id)
                
                if new_name:
                    yield sse_event({"auto_renamed": True, "new_name": new_name})
                
                yield sse_event({"done": True})
            else:
                # Just save and cleanup on cancel
                generation_data = active_generations.get(generation_id)
                if generation_data and generation_data.get('document_id'):
                    write_document_to_disk(generation_data['document_id'])
                cleanup_generation(generation_id)
            
    except requests.exceptions.Timeout:
        logger.error(f"{api_name} timeout")
        yield sse_event({"error": f"{api_name} timeout - server took too long to respond"})
        cleanup_generation(generation_id)
    except requests.exceptions.ConnectionError as e:
        logger.error(f"{api_name} connection error: {str(e)}")
        yield sse_event({"error": f"{api_name} connection error - unable to connect to server"})
        cleanup_generation(generation_id)
    except Exception as e:
        logger.error(f"{api_name} error: {str(e)}")
        yield sse_event({"error": f"{api_name} error: {str(e)}"})
        cleanup_generation(generation_id)

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
    
    # Normalize endpoint URL
    base_url = config.get('openai_endpoint', 'http://localhost:8080/v1')
    endpoint_url = base_url if base_url.endswith('/completions') else f"{base_url.rstrip('/')}/completions"
    
    # Build headers
    headers = {'Content-Type': 'application/json'}
    api_key = config.get('custom_api_key') or config.get('token')
    if api_key:
        headers['Authorization'] = f"Bearer {api_key}"
    
    # Build payload
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
    
    # Use unified streaming handler
    yield from stream_api_request(endpoint_url, headers, payload, generation_id, 'openai', 'OpenAI-compatible API')

def chutes_stream_generator(generation_id):
    """Generator function for Chutes API streaming responses"""
    generation_data = active_generations[generation_id]
    prompt = generation_data['prompt']
    
    endpoint_url = 'https://llm.chutes.ai/v1/completions'
    
    # Build headers
    headers = {'Content-Type': 'application/json'}
    api_key = config.get('custom_api_key') or config.get('token')
    if api_key:
        headers['Authorization'] = f"Bearer {api_key}"
    
    # Build payload
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
    
    # Use unified streaming handler
    yield from stream_api_request(endpoint_url, headers, payload, generation_id, 'openai', 'Chutes API')

def generate_document_name(content):
    """Generate a 2-4 word document name based on content"""
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
            'model': 'moonshotai/kimi-k2',  # Use specified model for renaming
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
    """Generator function for OpenRouter streaming API responses"""
    generation_data = active_generations[generation_id]
    prompt = generation_data['prompt']
    
    headers = {
        'Authorization': f"Bearer {config['token']}",
        'Content-Type': 'application/json'
    }
    
    # Parse model for provider targeting: "model::provider"
    model_str = config['model']
    target_provider = None
    if '::' in model_str:
        model_str, target_provider = model_str.split('::', 1)
    
    # Check if using untitled.txt trick from config toggle
    use_anthropic_trick = config.get('untitled_trick', False)
    response_format = 'chat' if use_anthropic_trick else 'openai'
    
    # Build endpoint and payload
    if use_anthropic_trick:
        endpoint_url = 'https://openrouter.ai/api/v1/chat/completions'
        payload = {
            'model': model_str,
            'max_tokens': config['max_tokens'],
            'temperature': config['temperature'],
            'system': "The assistant is in CLI simulation mode, and responds to the user's CLI commands only with the output of the command.",
            'messages': [
                {'role': 'user', 'content': f"<cmd>cat untitled.txt</cmd> (5.8 KB)"},
                {'role': 'assistant', 'content': prompt}
            ],
            'stream': True
        }
    else:
        endpoint_url = config['endpoint']
        payload = {
            'model': model_str,
            'prompt': prompt,
            'temperature': config['temperature'],
            'min_p': config['min_p'],
            'presence_penalty': config['presence_penalty'],
            'repetition_penalty': config['repetition_penalty'],
            'max_tokens': config['max_tokens'],
            'stream': True
        }
    
    # Add stop tokens for seed generation
    if generation_data.get('is_seed'):
        payload['stop'] = SEED_STOP_TOKENS
    
    # Add provider targeting if specified
    if target_provider:
        payload['provider'] = {'order': [target_provider], 'allow_fallbacks': False}
    
    # Use unified streaming handler
    yield from stream_api_request(endpoint_url, headers, payload, generation_id, response_format, 'OpenRouter API')

# ============================
# Routes
# ============================

@app.route('/')
def index():
    """Render the main application page"""
    return render_template('index.html', config=config)

@app.route('/view/<doc_id>')
def view_document(doc_id):
    """Render a single document view (for middle-click/new tab)"""
    # Set this document as current
    if doc_id in config['documents']:
        config['current_document'] = doc_id
    return render_template('index.html', config=config)

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
        config['untitled_trick'] = request.form.get('untitled_trick') == 'on'
        # Debounce config write (1s delay)
        schedule_settings_write()
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
    content = request.form.get('content', '')
    doc_id, document = create_new_document(name, content)
    
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
        # Don't save config just for switching documents
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
    
    # Only require token for OpenRouter, not for OpenAI-compatible endpoints
    if config.get('provider') == 'openrouter' and not config['token']:
        return jsonify({'success': False, 'error': 'No token provided'})
    
    # If prompt is empty, use seed prompt
    if not prompt or not prompt.strip():
        prompt = SEED_PROMPT
        is_seed = True
    else:
        is_seed = False
    
    # Generate a unique ID for this request
    generation_id = str(uuid.uuid4())
    
    # Store the prompt and additional data for streaming
    active_generations[generation_id] = {
        'prompt': prompt,
        'document_id': doc_id,
        'active': True,
        'is_seed': is_seed
    }
    
    return jsonify({'success': True, 'generation_id': generation_id})

@app.route('/cancel/<generation_id>', methods=['POST'])
def cancel(generation_id):
    """Cancel an in-progress generation"""
    if generation_id in active_generations:
        active_generations[generation_id]['active'] = False
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': 'Generation not found'})

@app.route('/generate_name', methods=['POST'])
def generate_name_endpoint():
    """Generate a document name from content"""
    try:
        data = request.get_json()
        content = data.get('content', '')
        
        if not content or not content.strip():
            return jsonify({'success': False, 'error': 'No content provided'})
        
        name = generate_document_name(content)
        return jsonify({'success': True, 'name': name})
    except Exception as e:
        logger.error(f"Error in generate_name endpoint: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_seed', methods=['POST'])
def get_seed():
    """Generate seed text for empty documents"""
    if not config['token']:
        return jsonify({'success': False, 'error': 'No API token configured'})
    
    try:
        headers = {
            'Authorization': f"Bearer {config['token']}",
            'Content-Type': 'application/json'
        }
        
        model_str = config['model']
        if '::' in model_str:
            model_str = model_str.split('::', 1)[0]
        
        # Check if using untitled.txt trick from config toggle
        use_anthropic_trick = config.get('untitled_trick', False)
        
        if use_anthropic_trick:
            endpoint_url = 'https://openrouter.ai/api/v1/chat/completions'
            payload = {
                'model': model_str,
                'max_tokens': config['max_tokens'],
                'temperature': config['temperature'],
                'system': "The assistant is in CLI simulation mode, and responds to the user's CLI commands only with the output of the command.",
                'messages': [
                    {'role': 'user', 'content': f"<cmd>cat untitled.txt</cmd> (5.8 KB)"},
                    {'role': 'assistant', 'content': SEED_PROMPT}
                ],
                'stream': True
            }
        else:
            endpoint_url = config['endpoint']
            payload = {
                'model': model_str,
                'prompt': SEED_PROMPT,
                'temperature': config['temperature'],
                'min_p': config['min_p'],
                'presence_penalty': config['presence_penalty'],
                'repetition_penalty': config['repetition_penalty'],
                'max_tokens': config['max_tokens'],
                'stream': True
            }
        
        logger.info(f"Making seed request to: {endpoint_url}")
        
        accumulated = ''
        with requests.post(endpoint_url, headers=headers, json=payload, stream=True, timeout=30) as response:
            if response.status_code != 200:
                return jsonify({'success': False, 'error': f'API error: {response.status_code}'})
            
            buffer = ""
            for chunk in response.iter_content(chunk_size=1024, decode_unicode=False):
                if chunk:
                    buffer += chunk.decode('utf-8', errors='replace')
                    while '\n' in buffer:
                        line_end = buffer.find('\n')
                        line = buffer[:line_end].strip()
                        buffer = buffer[line_end + 1:]
                        
                        if line.startswith('data: '):
                            response_format = 'chat' if use_anthropic_trick else 'openai'
                            content, is_done = parse_sse_stream(line, response_format)
                            if is_done:
                                break
                            if content:
                                accumulated += content
                                if any(token in accumulated for token in SEED_STOP_TOKENS):
                                    break
        
        # Clean up result
        min_idx = min((accumulated.find(t) for t in SEED_STOP_TOKENS if t in accumulated), default=len(accumulated))
        result = accumulated[:min_idx].rstrip(".'\u2018\u2019\u2026")
        
        logger.info(f"[SEED DEBUG] Returning: {result[:100]}...")
        return jsonify({'success': True, 'text': result})
    
    except Exception as e:
        logger.error(f"Seed generation error: {e}")
        return jsonify({'success': False, 'error': str(e)})

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
    """Save currently open document on shutdown"""
    global settings_write_timer
    # Cancel pending timers
    for timer in document_write_timers.values():
        if timer:
            timer.cancel()
    if settings_write_timer:
        settings_write_timer.cancel()
    
    # Only save the currently open document
    current_doc = config.get('current_document')
    if current_doc and current_doc in documents_cache:
        write_document_to_disk(current_doc)
        logger.info(f"Saved current document {current_doc} on shutdown")