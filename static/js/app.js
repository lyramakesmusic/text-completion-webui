// ============================
// Global Variables
// ============================
let editor = null;
let currentDocument = null;
let currentGenerationId = null;
let lastContent = '';
let isMobile = window.innerWidth <= 768;
let lastCheckpoint = null;  // Store the content checkpoint before generation
let lastEditFromAPI = false;  // Track if the last edit was from API generation
let errorToast = null;  // Store the toast instance

// Cache DOM elements
const domElements = {
    sidebar: document.getElementById('sidebar'),
    toggleSidebarBtn: document.getElementById('toggle-sidebar'),
    sidebarHandle: document.getElementById('sidebar-handle'),
    documentList: document.getElementById('document-list'),
    editorContainer: document.getElementById('editor-container'),
    emptyState: document.getElementById('empty-state'),
    currentDocumentName: document.getElementById('current-document-name'),
    submitBtn: document.getElementById('submit-btn'),
    cancelBtn: document.getElementById('cancel-btn'),
    rerollBtn: document.getElementById('reroll-btn'),
    clearBtn: document.getElementById('clear-btn'),
    newDocumentBtn: document.getElementById('new-document-btn'),
    emptyNewDocBtn: document.getElementById('empty-new-doc-btn'),
    documentNameForm: document.getElementById('document-name-form'),
    renameDocumentForm: document.getElementById('rename-document-form'),
    confirmDeleteBtn: document.getElementById('confirm-delete-btn'),
    tokenForm: document.getElementById('token-form'),
    errorToast: document.getElementById('error-toast'),
    errorToastBody: document.getElementById('error-toast-body')
};

// Create backdrop element
const backdrop = document.createElement('div');
backdrop.className = 'sidebar-backdrop';
document.body.appendChild(backdrop);

// ============================
// Editor Management
// ============================

/**
 * Initialize or reinitialize the editor
 */
function initEditor() {
    // Find or create the editor wrapper
    let editorWrapper = document.querySelector('.editor-wrapper');
    if (!editorWrapper) {
        editorWrapper = document.createElement('div');
        editorWrapper.className = 'editor-wrapper';
        domElements.editorContainer.appendChild(editorWrapper);
    } else {
        editorWrapper.innerHTML = '';
    }
    
    // Create textarea element
    const textarea = document.createElement('textarea');
    textarea.id = 'editor-textarea';
    textarea.className = 'editor-textarea';
    textarea.style.width = '100%';
    textarea.style.height = '100%';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.padding = '20px';
    textarea.style.resize = 'none';
    textarea.style.fontSize = '16px';
    textarea.style.fontFamily = "'Source Code Pro', 'Courier New', monospace";
    textarea.style.lineHeight = '1.6';
    textarea.spellcheck = false;
    
    // Apply theme based on config
    if (window.config && window.config.dark_mode) {
        textarea.style.backgroundColor = '#2a2a2a';
        textarea.style.color = '#fff';
    } else {
        textarea.style.backgroundColor = '#ffffff';
        textarea.style.color = '#000';
    }
    
    editorWrapper.appendChild(textarea);
    editor = textarea;
    
    // Track content changes and auto-save
    editor.addEventListener('input', function() {
        if (!currentDocument) return;
        
        const currentContent = editor.value;
        if (currentContent === lastContent) return;
        
        // Mark that this edit was from user input
        lastEditFromAPI = false;
        lastCheckpoint = null;  // Clear the checkpoint when user makes changes
        
        // Save immediately
        lastContent = currentContent;
        saveCurrentDocument();
    });
    
    // Add keyboard shortcuts
    editor.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + Enter to submit
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (!domElements.submitBtn.disabled) {
                domElements.submitBtn.click();
            }
            e.preventDefault();
        }
        
        // Tab key handling
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            
            // Insert tab at cursor
            this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
            
            // Put cursor after tab
            this.selectionStart = this.selectionEnd = start + 4;
        }
    });
}

// Add debounce function at the top with other utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Save the current document content to the server
 */
const saveCurrentDocument = debounce(function() {
    if (!currentDocument || !editor) return;
    
    const content = editor.value;
    
    // Update local state immediately
    currentDocument.content = content;
    currentDocument.updated_at = new Date().toISOString();
    
    // Silent save to server
    fetch(`/documents/${currentDocument.id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: content
        })
    })
    .catch(error => {
        console.error('Error saving document:', error);
    });
}, 500); // Debounce for 500ms

// ============================
// Token Management
// ============================

/**
 * Handle token form submission
 */
function handleTokenSubmit(e) {
    e.preventDefault();
    const tokenInput = document.getElementById('token-input');
    const token = tokenInput.value.trim();
    
    if (!token) {
        alert('Please enter an API token');
        return;
    }
    
    console.log('Submitting token...');
    fetch('/set_token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            'token': token
        })
    })
    .then(response => {
        console.log('Token response status:', response.status);
        return response.json();
    })
    .then(data => {
        console.log('Token response data:', data);
        if (data.success) {
            // Hide the warning alert with animation
            const warningAlert = document.querySelector('.warning-alert');
            if (warningAlert) {
                warningAlert.classList.add('hidden');
                // Remove the alert from DOM after animation
                setTimeout(() => {
                    warningAlert.remove();
                }, 300);
            }
            
            // Enable the submit button
            domElements.submitBtn.disabled = false;
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('tokenModal'));
            if (modal) {
                modal.hide();
            }
            
            // Clear the input
            tokenInput.value = '';
            
            // Reload the page to ensure all state is updated
            window.location.reload();
        } else {
            console.error('Error setting token:', data.error);
            alert('Error setting token: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error setting token:', error);
        alert('Error setting token: ' + error.message);
    });
}

// ============================
// Document Management
// ============================

/**
 * Load the document list from the server
 */
function loadDocuments() {
    fetch('/documents')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            if (!data.success) {
                console.error('Error loading documents:', data.error);
                showEmptyState();
                return;
            }

            // Always render the document list first for better responsiveness
            renderDocumentList(data.documents, data.current_document);
            
            // Handle empty document list
            if (!data.documents || data.documents.length === 0) {
                showEmptyState();
                return;
            }

            // If we have documents but no current document is selected, load the first one
            if (!data.current_document && data.documents.length > 0) {
                loadDocument(data.documents[0].id);
                return;
            }

            // Load the current document if it exists and is different from what we have
            if (data.current_document && (!currentDocument || currentDocument.id !== data.current_document)) {
                loadDocument(data.current_document);
            } else {
                hideEmptyState();
            }
        })
        .catch(error => {
            console.error('Error fetching documents:', error);
            showEmptyState();
        });
}

/**
 * Render the document list in the sidebar
 * @param {Array} documents - List of document objects
 * @param {String} currentDocId - ID of the current document
 */
function renderDocumentList(documents, currentDocId) {
    domElements.documentList.innerHTML = '';
    
    if (!documents || documents.length === 0) {
        domElements.documentList.innerHTML = '<li class="p-3 text-center text-muted">No documents yet</li>';
        return;
    }
    
    // Sort documents by updated_at (most recent first)
    documents.sort((a, b) => {
        return new Date(b.updated_at) - new Date(a.updated_at);
    });
    
    documents.forEach(doc => {
        const li = document.createElement('li');
        li.className = `document-item ${doc.id === currentDocId ? 'active' : ''}`;
        li.dataset.id = doc.id;
        
        // Format the date
        const updated = new Date(doc.updated_at);
        const formattedDate = formatRelativeTime(updated);
        
        li.innerHTML = `
            <div class="document-name">${doc.name}</div>
            <div class="d-flex align-items-center">
                <span class="document-time">${formattedDate}</span>
                <div class="document-actions dropdown ms-2" data-id="${doc.id}" data-name="${doc.name}">
                    <i class="bi bi-three-dots" data-bs-toggle="dropdown"></i>
                    <ul class="dropdown-menu dropdown-menu-end">
                        <li><a class="dropdown-item rename-doc" href="#" data-id="${doc.id}" data-name="${doc.name}">Rename</a></li>
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item delete-doc text-danger" href="#" data-id="${doc.id}" data-name="${doc.name}">Delete</a></li>
                    </ul>
                </div>
            </div>
        `;
        
        // Add click handler
        li.addEventListener('click', function(e) {
            // Don't handle the click if it was on or inside the actions menu
            if (e.target.closest('.document-actions') || e.target.closest('.dropdown-menu')) {
                e.stopPropagation();
                return;
            }
            
            loadDocument(doc.id);
        });
        
        domElements.documentList.appendChild(li);
    });
    
    // Add event listeners for document actions
    document.querySelectorAll('.document-actions').forEach(menu => {
        menu.addEventListener('click', function(e) {
            e.stopPropagation(); // Prevent the click from reaching the document item
        });
    });

    document.querySelectorAll('.rename-doc').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation(); // Prevent the click from reaching the document item
            const docId = this.dataset.id;
            const docName = this.dataset.name;
            showRenameDocumentModal(docId, docName);
        });
    });
    
    document.querySelectorAll('.delete-doc').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation(); // Prevent the click from reaching the document item
            const docId = this.dataset.id;
            const docName = this.dataset.name;
            showDeleteDocumentModal(docId, docName);
        });
    });
}

/**
 * Load a specific document
 * @param {String} docId - Document ID to load
 */
function loadDocument(docId) {
    // Update UI immediately for better responsiveness
    hideEmptyState();
    highlightActiveDocument(docId);
    
    // Set current document on server asynchronously
    fetch(`/documents/${docId}/set-current`, {
        method: 'POST'
    }).catch(error => {
        console.error('Error setting current document:', error);
    });
    
    // Load document content asynchronously
    fetch(`/documents/${docId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                currentDocument = data.document;
                
                // Update document name
                updateCurrentDocumentName(currentDocument.name);
                
                // Initialize or update editor with document content
                if (!editor) {
                    initEditor();
                }
                
                // Set editor content and update lastContent
                const content = currentDocument.content || '';
                if (editor.value !== content) {
                    editor.value = content;
                    lastContent = content;
                }
            } else {
                console.error('Error loading document:', data.error);
            }
        })
        .catch(error => {
            console.error('Error fetching document:', error);
        });
}

/**
 * Create a new document
 * @param {String} name - Document name
 */
function createNewDocument(name) {
    fetch('/documents/new', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            'name': name || 'Untitled'
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Reload documents list and load the new document
            loadDocuments();
        } else {
            console.error('Error creating document:', data.error);
        }
    })
    .catch(error => {
        console.error('Error creating document:', error);
    });
}

/**
 * Rename an existing document
 * @param {String} docId - Document ID
 * @param {String} newName - New document name
 */
function renameDocument(docId, newName) {
    fetch(`/documents/${docId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: newName
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update UI if the renamed document is the current one
            if (currentDocument && currentDocument.id === docId) {
                currentDocument.name = newName;
                updateCurrentDocumentName(newName);
            }
            
            // Reload documents list
            loadDocuments();
        } else {
            console.error('Error renaming document:', data.error);
        }
    })
    .catch(error => {
        console.error('Error renaming document:', error);
    });
}

/**
 * Delete a document
 * @param {String} docId - Document ID to delete
 */
function deleteDocument(docId) {
    fetch(`/documents/${docId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Reload documents list
            loadDocuments();
        } else {
            console.error('Error deleting document:', data.error);
        }
    })
    .catch(error => {
        console.error('Error deleting document:', error);
    });
}

// ============================
// Text Generation
// ============================

/**
 * Start streaming text generation
 * @param {String} generationId - ID of the generation request
 */
function startStreaming(generationId) {
    let generatedText = '';
    const originalText = editor.value;
    
    // Show cancel button and hide submit button during generation
    domElements.cancelBtn.style.display = 'block';
    domElements.submitBtn.style.display = 'none';
    
    const eventSource = new EventSource(`/stream/${generationId}`);
    
    eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);
        
        if (data.text) {
            // Store current cursor and scroll positions
            const currentScroll = editor.scrollTop;
            const currentSelection = {
                start: editor.selectionStart,
                end: editor.selectionEnd
            };
            
            generatedText += data.text;
            
            // Update editor with generated text
            editor.value = originalText + generatedText;
            
            // Mark that this edit was from API
            lastEditFromAPI = true;
            
            // Restore cursor and scroll positions
            editor.scrollTop = currentScroll;
            editor.selectionStart = currentSelection.start;
            editor.selectionEnd = currentSelection.end;
            
            // Save immediately when new content is received
            lastContent = editor.value;
            saveCurrentDocument();
        }
        
        // Handle completion of generation
        if (data.done) {
            eventSource.close();
            currentGenerationId = null;
            
            // Enable submit button and hide cancel button
            domElements.submitBtn.disabled = false;
            domElements.submitBtn.style.display = 'block';
            domElements.cancelBtn.style.display = 'none';
            
            // Show reroll button since we now have a checkpoint
            domElements.rerollBtn.style.display = 'block';
        }
        
        // Handle error in generation
        if (data.error) {
            console.error('Error in generation:', data.error);
            eventSource.close();
            currentGenerationId = null;
            
            // Enable submit button and hide cancel button
            domElements.submitBtn.disabled = false;
            domElements.submitBtn.style.display = 'block';
            domElements.cancelBtn.style.display = 'none';
            
            // Show error toast
            showError(data.error);
        }
        
        // Handle cancellation
        if (data.cancelled) {
            eventSource.close();
            currentGenerationId = null;
            
            // Enable submit button and hide cancel button
            domElements.submitBtn.disabled = false;
            domElements.submitBtn.style.display = 'block';
            domElements.cancelBtn.style.display = 'none';
        }
    };
    
    eventSource.onerror = function(error) {
        console.error('Error in text generation stream:', error);
        eventSource.close();
        currentGenerationId = null;
        
        // Re-enable submit button and hide cancel button
        domElements.submitBtn.disabled = false;
        domElements.submitBtn.style.display = 'block';
        domElements.cancelBtn.style.display = 'none';
        
        // Show error toast
        showError('Connection error occurred. Please try again.');
    };

    // Store EventSource instance for cleanup
    window.currentEventSource = eventSource;
}

// ============================
// UI Event Handlers
// ============================

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Load initial documents
    loadDocuments();
    
    // Set up event listeners
    domElements.toggleSidebarBtn.addEventListener('click', function() {
        if (isMobile) {
            toggleMobileSidebar();
        } else {
            domElements.sidebar.classList.toggle('collapsed');
        }
    });
    
    // Add event listener for sidebar handle if it exists
    if (domElements.sidebarHandle) {
        domElements.sidebarHandle.addEventListener('click', function() {
            if (isMobile) {
                toggleMobileSidebar();
            } else {
                domElements.sidebar.classList.toggle('collapsed');
            }
        });
    }
    
    // Remove clear button from DOM
    if (domElements.clearBtn) {
        domElements.clearBtn.remove();
        delete domElements.clearBtn;
    }
    
    // Add token form handler
    if (domElements.tokenForm) {
        domElements.tokenForm.addEventListener('submit', handleTokenSubmit);
    }
    
    domElements.submitBtn.addEventListener('click', function() {
        if (!editor || !currentDocument) return;
        
        // Disable submit button
        this.disabled = true;
        
        // Get content and strip trailing spaces from each line while preserving newlines
        const content = editor.value
            .split('\n')
            .map(line => line.trimEnd())
            .join('\n')
            .trimEnd(); // Also trim any trailing newlines at the end of the document
        
        // Save checkpoint before generation
        lastCheckpoint = content;
        
        // Start generation request
        fetch('/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'prompt': content,
                'document_id': currentDocument.id
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                currentGenerationId = data.generation_id;
                startStreaming(data.generation_id);
            } else {
                console.error('Error starting generation:', data.error);
                domElements.submitBtn.disabled = false;
            }
        })
        .catch(error => {
            console.error('Error starting generation:', error);
            domElements.submitBtn.disabled = false;
        });
    });
    
    // Document creation form handling
    domElements.documentNameForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const nameInput = document.getElementById('document-name-input');
        const name = nameInput.value.trim();
        if (name) {
            createNewDocument(name);
            nameInput.value = '';
            const modal = bootstrap.Modal.getInstance(document.getElementById('documentNameModal'));
            if (modal) {
                modal.hide();
            }
        }
    });
    
    // Document rename form handling
    domElements.renameDocumentForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const docId = document.getElementById('rename-document-id').value;
        const nameInput = document.getElementById('rename-document-input');
        const newName = nameInput.value.trim();
        if (docId && newName) {
            renameDocument(docId, newName);
            nameInput.value = '';
            const modal = bootstrap.Modal.getInstance(document.getElementById('renameDocumentModal'));
            if (modal) {
                modal.hide();
            }
        }
    });
    
    // Document deletion confirmation
    domElements.confirmDeleteBtn.addEventListener('click', function() {
        const docId = this.dataset.documentId;
        if (docId) {
            deleteDocument(docId);
            const modal = bootstrap.Modal.getInstance(document.getElementById('deleteDocumentModal'));
            if (modal) {
                modal.hide();
            }
        }
    });
    
    // New document button handlers
    domElements.newDocumentBtn.addEventListener('click', function() {
        const modal = new bootstrap.Modal(document.getElementById('documentNameModal'));
        modal.show();
    });
    
    domElements.emptyNewDocBtn.addEventListener('click', function() {
        const modal = new bootstrap.Modal(document.getElementById('documentNameModal'));
        modal.show();
    });

    // Add cancel button handler
    domElements.cancelBtn.addEventListener('click', function() {
        if (currentGenerationId) {
            // Close the EventSource first
            if (window.currentEventSource) {
                window.currentEventSource.close();
            }
            
            // Send cancel request to server
            fetch(`/cancel/${currentGenerationId}`, {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                if (!data.success) {
                    console.error('Error cancelling generation:', data.error);
                }
                // Reset UI state regardless of server response
                currentGenerationId = null;
                domElements.submitBtn.disabled = false;
                domElements.submitBtn.style.display = 'block';
                domElements.cancelBtn.style.display = 'none';
            })
            .catch(error => {
                console.error('Error cancelling generation:', error);
                // Reset UI state on error
                currentGenerationId = null;
                domElements.submitBtn.disabled = false;
                domElements.submitBtn.style.display = 'block';
                domElements.cancelBtn.style.display = 'none';
            });
        }
    });

    // Add reroll button handler
    domElements.rerollBtn.addEventListener('click', function() {
        if (!lastCheckpoint) return;
        
        // Immediately restore content for better responsiveness
        editor.value = lastCheckpoint;
        lastContent = lastCheckpoint;
        saveCurrentDocument();
        
        // If there's an active generation, cancel it asynchronously
        if (currentGenerationId) {
            // Close the EventSource first
            if (window.currentEventSource) {
                window.currentEventSource.close();
            }
            
            // Send cancel request to server asynchronously
            fetch(`/cancel/${currentGenerationId}`, {
                method: 'POST'
            }).catch(error => {
                console.error('Error cancelling generation:', error);
            });
            
            // Reset UI state immediately
            currentGenerationId = null;
            domElements.submitBtn.disabled = false;
            domElements.submitBtn.style.display = 'block';
            domElements.cancelBtn.style.display = 'none';
        }
        
        // Start a new generation immediately
        domElements.submitBtn.click();
    });
});

// ============================
// Utility Functions
// ============================

/**
 * Format a date relative to now (e.g. "2 hours ago")
 * @param {Date} date - Date to format
 * @return {String} Formatted relative time string
 */
function formatRelativeTime(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) {
        return 'just now';
    }
    
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
        return `${diffInMinutes}m ago`;
    }
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
        return `${diffInHours}h ago`;
    }
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) {
        return `${diffInDays}d ago`;
    }
    
    return date.toLocaleDateString();
}

/**
 * Update the current document name in the UI
 * @param {String} name - Document name
 */
function updateCurrentDocumentName(name) {
    domElements.currentDocumentName.textContent = name;
}

/**
 * Highlight the active document in the sidebar
 * @param {String} docId - Document ID
 */
function highlightActiveDocument(docId) {
    document.querySelectorAll('.document-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === docId);
    });
}

/**
 * Show the empty state UI
 */
function showEmptyState() {
    domElements.emptyState.style.display = 'flex';
    
    // Find the editor wrapper and hide it if it exists
    const editorWrapper = document.querySelector('.editor-wrapper');
    if (editorWrapper && editorWrapper.contains(document.getElementById('editor-textarea'))) {
        editorWrapper.style.display = 'none';
    }
    
    domElements.currentDocumentName.textContent = '';
}

/**
 * Hide the empty state UI
 */
function hideEmptyState() {
    domElements.emptyState.style.display = 'none';
    
    // Find the editor wrapper and show it
    const editorWrapper = document.querySelector('.editor-wrapper');
    if (editorWrapper) {
        editorWrapper.style.display = 'block';
    }
    
    domElements.editorContainer.style.display = 'flex';
}

/**
 * Show the rename document modal
 * @param {String} docId - Document ID
 * @param {String} currentName - Current document name
 */
function showRenameDocumentModal(docId, currentName) {
    const modal = document.getElementById('renameDocumentModal');
    const form = modal.querySelector('#rename-document-form');
    const input = form.querySelector('#rename-document-input');

    form.querySelector('#rename-document-id').value = docId;
    input.value = currentName;

    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
    input.select();
}

/**
 * Show the delete document modal
 * @param {String} docId - Document ID
 * @param {String} docName - Document name
 */
function showDeleteDocumentModal(docId, docName) {
    const modal = document.getElementById('deleteDocumentModal');
    const confirmBtn = modal.querySelector('#confirm-delete-btn');
    const docNameSpan = modal.querySelector('#delete-document-name');
    
    confirmBtn.dataset.documentId = docId;
    docNameSpan.textContent = docName;
    
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
}

// ============================
// Event Listeners
// ============================

// Update isMobile on resize
window.addEventListener('resize', () => {
    const wasMobile = isMobile;
    isMobile = window.innerWidth <= 768;
    
    // Reset sidebar state when switching between mobile and desktop
    if (wasMobile !== isMobile) {
        closeMobileSidebar();
    }
});

function toggleMobileSidebar() {
    domElements.sidebar.classList.toggle('show');
    document.body.classList.toggle('sidebar-open');
    backdrop.classList.toggle('show');
}

function closeMobileSidebar() {
    domElements.sidebar.classList.remove('show');
    document.body.classList.remove('sidebar-open');
    backdrop.classList.remove('show');
}

// Close sidebar when selecting a document on mobile
domElements.documentList.addEventListener('click', (e) => {
    const documentItem = e.target.closest('.document-item');
    if (documentItem && isMobile) {
        closeMobileSidebar();
    }
});

// Initialize error toast
function initErrorToast() {
    errorToast = new bootstrap.Toast(domElements.errorToast, {
        animation: true,
        autohide: true,
        delay: 5000
    });
}

function showError(message) {
    if (!errorToast) {
        initErrorToast();
    }
    domElements.errorToastBody.textContent = message;
    errorToast.show();
}