# OpenRouter Text Completion Interface

A simple writing/editing app for using base LLMs in a classic-gpt3-like text sandbox. Edit and reroll completions as desired with no setup or interface friction, just a text box and unlimited format potential.

## Features

- Text completion using llama3-405b-base via OpenRouter
- Simple document management (create, edit, rename, delete)
- Quick keyboard shortcuts (Ctrl+Enter or Cmd+Enter for completions)
- Automatically saves as you type
- Customizable temperature/sampling settings

## Quick Start

1. **Install Python** (3.7 or higher) if you haven't already
2. **Install the required packages**:
   ```bash
   pip install flask requests
   ```
3. **Run the application**:
   ```bash
   python app.py
   ```
4. **Open your browser** and go to `http://127.0.0.1:5000`

## Requirements

- Python 3.7 or higher
- Flask
- Requests
- OpenRouter API key (you'll be prompted to enter this in the settings)

## Usage

1. **First Time Setup**:
   - Launch the application
   - Go to Settings (gear icon)
   - Enter your OpenRouter API key (https://openrouter.ai/settings/keys)
   - Choose your preferred AI model and settings

2. **Creating Content**:
   - Click "New Document" to start writing
   - Type your text in the main editor
   - Press Ctrl+Enter (or Cmd+Enter) to get AI suggestions
   - Accept or reject suggestions as needed

3. **Managing Documents**:
   - Use the sidebar to switch between documents
   - Right-click documents to rename or delete
   - All changes are automatically saved

## Settings

You can change model settings through the settings panel:

- **Model Selection**: Choose from various OpenRouter models
- **Temperature**: Control creativity (0-2)
- **Min P**: Filter low-probability suggestions (0-1)
- **Presence/Repetition Penalty**: Fine-tune output quality


## Contributing

Contributions are welcome! Feel free to submit issues and pull requests.
