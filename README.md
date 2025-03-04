# OpenRouter Text Completion Interface

A clean, modern interface for text completion using the OpenRouter API, featuring document management and a collapsible sidebar.

## Features

- **Document Management**: Create, edit, rename, and delete documents
- **Collapsible Sidebar**: Toggle sidebar visibility for more editing space
- **Full State Persistence**: All documents and settings saved between sessions
- **Keyboard Shortcuts**: Ctrl+Enter (or Cmd+Enter) to generate completions

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   pip install flask requests
   ```
3. Create the following directory structure:
   ```
   your_project/
   ├── app.py
   ├── static/
   │   └── js/
   │       └── app.js
   └── templates/
       ├── index.html
       └── settings.html
   ```
4. Run the application:
   ```
   python app.py
   ```
5. Access the interface at `http://127.0.0.1:5000`

## Configuration

On first run, the application will create a configuration directory at `~/.openrouter-flask` containing:

- `config.json`: Application settings and document list
- `documents/`: Directory containing document JSON files

You'll need to set your OpenRouter API token in the interface before generating completions.

## Project Structure

- **`app.py`**: Main Flask application with API routes and document management
- **`static/js/app.js`**: Frontend JavaScript for the editor and document management
- **`templates/index.html`**: Main editor interface with sidebar and document list
- **`templates/settings.html`**: Settings page for configuring OpenRouter API parameters

## How It Works

### Document Management

Documents are stored as JSON files in the `~/.openrouter-flask/documents` directory. Each document contains:

- Basic metadata (name, creation/update timestamps)
- Document content
- Version history (last 50 versions)

### Settings

The application supports configuring various OpenRouter API parameters:

- **Model**: LLM to use for completion (e.g., `meta-llama/llama-3.1-405b`)
- **Temperature**: Controls randomness in generation (0-2)
- **Min P**: Filters low-probability tokens (0-1)
- **Presence Penalty**: Reduces repetition of tokens (0-2)
- **Repetition Penalty**: Reduces phrase repetition (1-2)

## Development

### Modifying Styles

Styles are defined within the HTML files for simplicity. Main styling is in `templates/index.html` and `templates/settings.html`.

### Adding Features

To add new features:

1. Modify `app.py` to add new backend routes or functionality
2. Update `static/js/app.js` to implement frontend behavior
3. Modify templates in `templates/` directory to update the UI

## License

MIT License