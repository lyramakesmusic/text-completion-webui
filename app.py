from flask import Flask, render_template, request, jsonify, Response, session
import requests
import json
import os
import uuid
import datetime
import logging
from threading import Timer
from threading import Lock

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
    'documents': []  # List of document IDs
}

# Active generation requests
active_generations = {}

# In-memory document storage
documents_cache = {}
write_timer = None
write_lock = Lock()
WRITE_DELAY = 1.0  # seconds

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
    
    document = {
        'id': doc_id,
        'name': name,
        'created_at': now,
        'updated_at': now,
        'content': ''
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
    document['updated_at'] = datetime.datetime.now().isoformat()
    
    if save_document(doc_id, document):
        return True, document
    return False, None

def update_document_content(doc_id, content):
    """Update a document's content"""
    document = load_document(doc_id)
    if not document:
        return False, None
    
    document['content'] = content
    document['updated_at'] = datetime.datetime.now().isoformat()
    
    if save_document(doc_id, document):
        return True, document
    return False, None

def get_all_documents():
    """Get list of all documents with metadata"""
    documents = []
    for doc_id in config['documents']:
        doc = load_document(doc_id)
        if doc:
            documents.append({
                'id': doc_id,
                'name': doc.get('name', 'Untitled'),
                'updated_at': doc.get('updated_at'),
                'created_at': doc.get('created_at')
            })
    return sorted(documents, key=lambda x: x['updated_at'], reverse=True)

def document_exists(doc_id):
    """Check if a document exists"""
    return os.path.exists(get_document_path(doc_id))

# ============================
# API Functions
# ============================

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
                                yield "data: " + json.dumps({"done": True}) + "\n\n"
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
            
            # Clean up
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
    
    response = Response(stream_generator(generation_id), mimetype="text/event-stream")
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
                    documents_cache[doc_id] = json.load(f)
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