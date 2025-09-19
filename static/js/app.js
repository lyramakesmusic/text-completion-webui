// ============================
// Global Variables
// ============================
let editor = null;
let currentDocument = null;
let currentGenerationId = null;
let lastContent = '';
let isMobile = window.innerWidth <= 1000;
let lastCheckpoint = null;  // Store the content checkpoint before generation
let lastEditFromAPI = false;  // Track if the last edit was from API generation
let errorToast = null;  // Store the toast instance
let autosaveToast = null;  // Store the autosave toast instance
let autorenameToast = null;  // Store the autorename toast instance

// Cache DOM elements
const domElements = {
    sidebar: document.getElementById('sidebar'),
    toggleSidebarBtn: document.getElementById('toggle-sidebar'),
    sidebarHandle: document.getElementById('sidebar-handle'),
    documentList: document.getElementById('document-list'),
    documentSearch: document.getElementById('document-search'),
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
    errorToastBody: document.getElementById('error-toast-body'),
    // Settings sidebar elements
    settingsSidebar: document.getElementById('settings-sidebar'),
    toggleSettingsBtn: document.getElementById('toggle-settings'),
    closeSettingsBtn: document.getElementById('close-settings'),
    settingsFormInline: document.getElementById('settings-form-inline'),
    autosaveToast: document.getElementById('autosave-toast'),
    autorenameToast: document.getElementById('autorename-toast'),
    autorenameToastText: document.getElementById('autorename-toast-text'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop')
};

// Backdrop is already in HTML, no need to create it

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
    textarea.spellcheck = false;
    
    editorWrapper.appendChild(textarea);
    editor = textarea;
    
    // Track content changes and auto-save with performance optimization for large documents
    editor.addEventListener('input', function() {
        if (!currentDocument) return;
        
        const currentContent = editor.value;
        if (currentContent === lastContent) return;
        
        // Mark that this edit was from user input
        lastEditFromAPI = false;
        lastCheckpoint = null;  // Clear the checkpoint when user makes changes
        
        // Update lastContent immediately to prevent duplicate saves
        lastContent = currentContent;
        
        // Use longer debounce for large documents to improve performance
        const contentLength = currentContent.length;
        const debounceTime = contentLength > 50000 ? 1500 : contentLength > 20000 ? 1000 : 500;
        
        // Cancel previous save timer and schedule new one
        if (window.saveTimer) {
            clearTimeout(window.saveTimer);
        }
        window.saveTimer = setTimeout(() => {
            saveCurrentDocument();
            window.saveTimer = null;
        }, debounceTime);
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
 * Now called directly without debounce since debouncing is handled at the input level
 */
function saveCurrentDocument() {
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
}

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

// Cache for search results to avoid redundant API calls
let searchCache = new Map();
let lastSearchRequest = null;

/**
 * Search documents by keyword
 * @param {String} query - Search query
 */
function searchDocuments(query) {
    // Debounce: cancel previous request if still pending
    if (lastSearchRequest) {
        lastSearchRequest.abort();
    }
    
    const cacheKey = query || 'all';
    
    // Check cache first for non-empty queries
    if (query && searchCache.has(cacheKey)) {
        const cachedData = searchCache.get(cacheKey);
        renderDocumentList(cachedData.documents, currentDocument ? currentDocument.id : null, {
            query: cachedData.query,
            search_type: cachedData.search_type
        });
        return;
    }
    
    const url = query ? `/documents/search?q=${encodeURIComponent(query)}` : '/documents';
    const controller = new AbortController();
    lastSearchRequest = controller;
    
    fetch(url, { signal: controller.signal })
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            lastSearchRequest = null;
            
            if (!data.success) {
                console.error('Error searching documents:', data.error);
                return;
            }

            // Cache the results for future use (limit cache size)
            if (query) {
                if (searchCache.size >= 10) {
                    // Remove oldest entry
                    const firstKey = searchCache.keys().next().value;
                    searchCache.delete(firstKey);
                }
                searchCache.set(cacheKey, data);
            }

            // Render the filtered document list with search information
            renderDocumentList(data.documents, currentDocument ? currentDocument.id : null, {
                query: data.query,
                search_type: data.search_type
            });
            
            // Show "no results" message if search returned empty
            if (query && data.documents.length === 0) {
                domElements.documentList.innerHTML = '<li class="p-3 text-center" style="color: var(--text-secondary); opacity: 0.7;">No documents match search query</li>';
            }
        })
        .catch(error => {
            if (error.name !== 'AbortError') {
                console.error('Error searching documents:', error);
            }
            lastSearchRequest = null;
        });
}

// Cache for document elements to avoid full rebuilds
let documentElementsCache = new Map();
let lastSearchQuery = '';

/**
 * Render the document list in the sidebar
 * @param {Array} documents - List of document objects
 * @param {String} currentDocId - ID of the current document
 * @param {Object} searchInfo - Information about the search (query, search_type)
 */
function renderDocumentList(documents, currentDocId, searchInfo = null) {
    if (!documents || documents.length === 0) {
        domElements.documentList.innerHTML = '<li class="p-3 text-center text-muted">No documents yet</li>';
        documentElementsCache.clear();
        return;
    }
    
    // Only sort by updated_at if not searching
    if (!searchInfo || !searchInfo.query) {
        documents.sort((a, b) => {
            return new Date(b.updated_at) - new Date(a.updated_at);
        });
    }
    
    // Check if we can do a fast update (same documents, just different order or metrics)
    const currentQuery = searchInfo?.query || '';
    const existingElements = Array.from(domElements.documentList.children);
    const canFastUpdate = existingElements.length === documents.length && 
                         existingElements.every(el => documents.some(doc => doc.id === el.dataset.id));
    
    if (canFastUpdate && lastSearchQuery !== '' && currentQuery !== '') {
        // Fast update: just reorder existing elements and update metrics
        const fragment = document.createDocumentFragment();
        documents.forEach(doc => {
            const existingElement = Array.from(existingElements).find(el => el.dataset.id === doc.id);
            if (existingElement) {
                // Update the time/metric display
                const timeSpan = existingElement.querySelector('.document-time');
                if (timeSpan) {
                    let timeOrMetric = getTimeOrMetric(doc, searchInfo);
                    timeSpan.textContent = timeOrMetric;
                }
                
                // Update active state
                existingElement.className = `document-item ${doc.id === currentDocId ? 'active' : ''}`;
                
                fragment.appendChild(existingElement);
            }
        });
        domElements.documentList.appendChild(fragment);
    } else {
        // Full rebuild needed
        domElements.documentList.innerHTML = '';
        documentElementsCache.clear();
        
        documents.forEach(doc => {
            const li = createDocumentElement(doc, currentDocId, searchInfo);
            domElements.documentList.appendChild(li);
            documentElementsCache.set(doc.id, li);
        });
        
        // Re-attach event listeners
        attachDocumentEventListeners();
    }
    
    lastSearchQuery = currentQuery;
}

/**
 * Get the appropriate time or metric string for a document
 */
function getTimeOrMetric(doc, searchInfo) {
    if (searchInfo && searchInfo.query) {
        // Show search metric based on search type
        if (searchInfo.search_type === 'embeddings' && doc.similarity_score !== undefined) {
            // Round cosine similarity to 2 decimal places
            return (doc.similarity_score).toFixed(2);
        } else if (searchInfo.search_type === 'keyword' && doc.occurrence_count !== undefined) {
            // Show integer number of keyword appearances
            return doc.occurrence_count.toString();
        }
    }
    // Show regular timestamp
    const updated = new Date(doc.updated_at);
    return formatRelativeTime(updated);
}

/**
 * Create a document element
 */
function createDocumentElement(doc, currentDocId, searchInfo) {
    const li = document.createElement('li');
    li.className = `document-item ${doc.id === currentDocId ? 'active' : ''}`;
    li.dataset.id = doc.id;
    
    const timeOrMetric = getTimeOrMetric(doc, searchInfo);
    
    li.innerHTML = `
        <div class="document-name">${doc.name}</div>
        <div class="d-flex align-items-center">
            <span class="document-time">${timeOrMetric}</span>
            <div class="document-actions dropdown ms-2" data-id="${doc.id}" data-name="${doc.name}">
                <i class="bi bi-three-dots" data-bs-toggle="dropdown"></i>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><a class="dropdown-item download-doc" href="#" data-id="${doc.id}" data-name="${doc.name}">Download as .txt</a></li>
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
    
    return li;
}

/**
 * Attach event listeners to document action buttons
 */
function attachDocumentEventListeners() {
    // Add event listeners for document actions
    document.querySelectorAll('.document-actions').forEach(menu => {
        menu.addEventListener('click', function(e) {
            e.stopPropagation(); // Prevent the click from reaching the document item
        });
    });

    document.querySelectorAll('.download-doc').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation(); // Prevent the click from reaching the document item
            const docId = this.dataset.id;
            const docName = this.dataset.name;
            downloadDocument(docId, docName);
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
 * Download a document as .txt file
 * @param {String} docId - Document ID to download
 * @param {String} docName - Document name for filename
 */
function downloadDocument(docId, docName) {
    fetch(`/documents/${docId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const content = data.document.content || '';
                const filename = `${docName}.txt`;
                
                // Create a blob with the content
                const blob = new Blob([content], { type: 'text/plain' });
                
                // Create a temporary download link
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                
                // Trigger the download
                document.body.appendChild(a);
                a.click();
                
                // Clean up
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } else {
                console.error('Error downloading document:', data.error);
            }
        })
        .catch(error => {
            console.error('Error downloading document:', error);
        });
}

/**
 * Delete a document
 * @param {String} docId - Document ID to delete
 */
function deleteDocument(docId) {
    // Check if we're deleting the current document
    const isDeletingCurrentDoc = currentDocument && currentDocument.id === docId;
    
    fetch(`/documents/${docId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // If we deleted the current document, create a new blank one
            if (isDeletingCurrentDoc) {
                createNewDocument('Untitled');
            } else {
                // Otherwise just reload the documents list
                loadDocuments();
            }
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
            // Performance optimization: use insertAdjacentText for incremental updates
            const wasAtEnd = editor.selectionStart === editor.value.length;
            const currentScroll = editor.scrollTop;
            const scrollAtBottom = editor.scrollTop >= (editor.scrollHeight - editor.clientHeight - 10);
            
            generatedText += data.text;
            
            // For large documents, minimize DOM manipulation
            if (editor.value.length > 50000) {
                // Batch updates: only update every 10 chunks or when done
                if (!window.streamUpdateBatch) {
                    window.streamUpdateBatch = { count: 0, pendingText: '' };
                }
                window.streamUpdateBatch.pendingText += data.text;
                window.streamUpdateBatch.count++;
                
                // Update every 10 chunks for large documents
                if (window.streamUpdateBatch.count >= 10) {
                    editor.value = originalText + generatedText;
                    window.streamUpdateBatch = { count: 0, pendingText: '' };
                    
                    // Restore position only if user was at end
                    if (wasAtEnd) {
                        editor.selectionStart = editor.selectionEnd = editor.value.length;
                    }
                    if (scrollAtBottom) {
                        editor.scrollTop = editor.scrollHeight;
                    }
                }
            } else {
                // Normal update for smaller documents
                editor.value = originalText + generatedText;
                
                // Restore cursor and scroll positions
                if (wasAtEnd) {
                    editor.selectionStart = editor.selectionEnd = editor.value.length;
                }
                if (scrollAtBottom) {
                    editor.scrollTop = editor.scrollHeight;
                } else {
                    editor.scrollTop = currentScroll;
                }
            }
            
            // Mark that this edit was from API
            lastEditFromAPI = true;
            
            // Update lastContent and save (debounced for large docs)
            lastContent = originalText + generatedText;
            if (window.saveTimer) {
                clearTimeout(window.saveTimer);
            }
            window.saveTimer = setTimeout(() => {
                saveCurrentDocument();
                window.saveTimer = null;
            }, editor.value.length > 50000 ? 1000 : 200);
        }
        
        // Handle auto-rename event
        if (data.auto_renamed) {
            // Show auto-rename toast notification
            showAutoRenameToast(data.new_name);
            
            // Update the current document object
            if (currentDocument) {
                currentDocument.name = data.new_name;
            }
            
            // 1. Update the main document name display in header
            const headerNameElement = document.getElementById('current-document-name');
            if (headerNameElement) {
                headerNameElement.textContent = data.new_name;
            }
            
            // 2. Update the sidebar document name
            const sidebarNameElement = document.querySelector(`.document-item.active .document-name`);
            if (sidebarNameElement) {
                sidebarNameElement.textContent = data.new_name;
            } else if (currentDocument) {
                // Fallback: find by document ID
                const sidebarByID = document.querySelector(`[data-id="${currentDocument.id}"] .document-name`);
                if (sidebarByID) {
                    sidebarByID.textContent = data.new_name;
                }
            }
            
            // 3. Update all data attributes in the sidebar for this document
            const activeDocumentItem = document.querySelector(`.document-item.active`);
            if (activeDocumentItem && currentDocument) {
                // Update dropdown menu data attributes
                const documentActions = activeDocumentItem.querySelector('.document-actions');
                if (documentActions) {
                    documentActions.setAttribute('data-name', data.new_name);
                    
                    // Update download, rename and delete links
                    const downloadLink = documentActions.querySelector('.download-doc');
                    const renameLink = documentActions.querySelector('.rename-doc');
                    const deleteLink = documentActions.querySelector('.delete-doc');
                    if (downloadLink) downloadLink.setAttribute('data-name', data.new_name);
                    if (renameLink) renameLink.setAttribute('data-name', data.new_name);
                    if (deleteLink) deleteLink.setAttribute('data-name', data.new_name);
                }
            }
        }
        
        // Handle completion of generation
        if (data.done) {
            // Flush any pending batched updates for large documents
            if (window.streamUpdateBatch && window.streamUpdateBatch.count > 0) {
                editor.value = originalText + generatedText;
                const wasAtEnd = editor.selectionStart === editor.value.length;
                if (wasAtEnd) {
                    editor.selectionStart = editor.selectionEnd = editor.value.length;
                    editor.scrollTop = editor.scrollHeight;
                }
                window.streamUpdateBatch = null;
            }
            
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
    // Initialize sidebar states based on saved preferences or defaults
    const savedSidebarState = localStorage.getItem('sidebarState');
    const savedSettingsState = localStorage.getItem('settingsSidebarState');
    
    if (!isMobile) {
        // Desktop: default to both open
        if (savedSidebarState === 'collapsed') {
            domElements.sidebar.classList.add('collapsed');
        } else {
            domElements.sidebar.classList.remove('collapsed');
        }
        
        // Settings sidebar defaults to open on desktop
        if (savedSettingsState === 'collapsed') {
            domElements.settingsSidebar.classList.add('collapsed');
        } else {
            // Default is open, so remove collapsed
            domElements.settingsSidebar.classList.remove('collapsed');
        }
    } else {
        // Mobile: always start closed
        domElements.sidebar.classList.remove('show');
        domElements.settingsSidebar.classList.remove('show');
        // Also ensure collapsed is removed on mobile
        domElements.settingsSidebar.classList.remove('collapsed');
    }
    
    // Apply light mode if needed (dark mode is now default)
    if (window.config && !window.config.dark_mode) {
        document.body.classList.add('light-mode');
    }
    
    // Load initial documents
    loadDocuments();
    
    // Set up search functionality - reduced debounce for faster response
    const debouncedSearch = debounce(function(query) {
        searchDocuments(query);
    }, 150);
    
    if (domElements.documentSearch) {
        domElements.documentSearch.addEventListener('input', function() {
            const query = this.value.trim();
            debouncedSearch(query);
        });
        
        // Clear search on Escape key
        domElements.documentSearch.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                this.value = '';
                searchDocuments('');
            }
        });
    }
    
    // Set up event listeners
    domElements.toggleSidebarBtn.addEventListener('click', function() {
        if (isMobile) {
            // Close settings sidebar if open
            closeMobileSettingsSidebar();
            toggleMobileSidebar();
        } else {
            domElements.sidebar.classList.toggle('collapsed');
            // Save state
            localStorage.setItem('sidebarState', 
                domElements.sidebar.classList.contains('collapsed') ? 'collapsed' : 'open');
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
    
    // Settings sidebar toggle
    domElements.toggleSettingsBtn.addEventListener('click', function() {
        if (isMobile) {
            // Close document sidebar if open
            closeMobileSidebar();
            toggleMobileSettingsSidebar();
        } else {
            domElements.settingsSidebar.classList.toggle('collapsed');
            // Save state
            localStorage.setItem('settingsSidebarState', 
                domElements.settingsSidebar.classList.contains('collapsed') ? 'collapsed' : 'open');
        }
    });
    
    // Close settings button
    domElements.closeSettingsBtn.addEventListener('click', function() {
        if (isMobile) {
            closeMobileSettingsSidebar();
        } else {
            domElements.settingsSidebar.classList.add('collapsed');
            // Save state
            localStorage.setItem('settingsSidebarState', 'collapsed');
        }
    });
    
    // Update model examples and field visibility based on provider
    function updateModelExamples() {
        const provider = document.getElementById('provider').value;
        const modelHelpText = document.getElementById('model-help-text');
        const openaiEndpointField = document.getElementById('openai-endpoint-field');
        const modelField = document.getElementById('model-field');
        const openrouterApiKeyField = document.getElementById('openrouter-api-key-field');
        const customApiKeyField = document.getElementById('custom-api-key-field');
        
        // Show/hide fields based on provider
        if (provider === 'openrouter') {
            // For OpenRouter: show only the OpenRouter API key field
            modelField.style.display = 'none';
            openaiEndpointField.style.display = 'none';
            openrouterApiKeyField.style.display = 'block';
            customApiKeyField.style.display = 'none';
        } else if (provider === 'openai') {
            // For OpenAI: show model, endpoint, and custom API key fields
            modelField.style.display = 'block';
            openaiEndpointField.style.display = 'block';
            openrouterApiKeyField.style.display = 'none';
            customApiKeyField.style.display = 'block';
            modelHelpText.innerHTML = 'N/A';
        } else if (provider === 'chutes') {
            // For Chutes: show model and custom API key fields
            modelField.style.display = 'block';
            openaiEndpointField.style.display = 'none';
            openrouterApiKeyField.style.display = 'none';
            customApiKeyField.style.display = 'block';
            modelHelpText.innerHTML = 'deepseek/deepseek-r1-0528:free<br>deepseek/deepseek-v3-base<br>thudm/glm-4-32b:free<br>moonshotai/kimi-k2:free<br>meta-llama/llama-3.1-405b';
        }
        
        // Update model examples for non-OpenRouter providers
        if (provider === 'openrouter') {
            // No model field shown for OpenRouter, so no need to update help text
        } else if (provider === 'openai') {
            modelHelpText.innerHTML = '';
        } else if (provider === 'chutes') {
            modelHelpText.innerHTML = 'deepseek/deepseek-r1-0528:free<br>deepseek/deepseek-v3-base<br>thudm/glm-4-32b:free<br>moonshotai/kimi-k2:free<br>meta-llama/llama-3.1-405b';
        }
    }
    
    // Update main model field examples when accordion is closed
    function updateMainModelExamples() {
        const mainModelHelpText = document.getElementById('main-model-help-text');
        // Always show OpenRouter examples when accordion is closed
        mainModelHelpText.innerHTML = 'deepseek/deepseek-r1-0528:free<br>deepseek/deepseek-v3-base<br>thudm/glm-4-32b:free<br>moonshotai/kimi-k2:free<br>meta-llama/llama-3.1-405b';
    }
    
    // Sync model values between main and advanced fields
    function syncModelFields(fromField, toField) {
        const from = document.getElementById(fromField);
        const to = document.getElementById(toField);
        if (from && to && from.value !== to.value) {
            to.value = from.value;
        }
    }
    
    // Handle accordion state changes
    function handleAccordionToggle(isOpen) {
        const mainModelField = document.getElementById('model-main');
        const advancedModelField = document.getElementById('model');
        
        if (isOpen) {
            // Accordion opened - disable main field, enable advanced
            mainModelField.disabled = true;
            mainModelField.style.opacity = '0.6';
            if (advancedModelField) {
                advancedModelField.disabled = false;
                // Sync value from main to advanced
                syncModelFields('model-main', 'model');
            }
        } else {
            // Accordion closed - enable main field, assume OpenRouter
            mainModelField.disabled = false;
            mainModelField.style.opacity = '1';
            updateMainModelExamples();
            if (advancedModelField) {
                // Sync value from advanced to main
                syncModelFields('model', 'model-main');
            }
        }
    }
    
    // Auto-save settings function
    function autoSaveSettings() {
        const formData = new FormData(domElements.settingsFormInline);
        
        // Handle OpenRouter API key separately if it's being changed
        const openrouterApiKey = formData.get('openrouter_api_key');
        if (openrouterApiKey && openrouterApiKey.trim()) {
            // Update the main OpenRouter token
            fetch('/set_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    'token': openrouterApiKey.trim()
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Clear the field after successful save
                    document.getElementById('openrouter_api_key').value = '';
                    
                    // Enable the submit button if it was disabled
                    if (domElements.submitBtn.disabled) {
                        domElements.submitBtn.disabled = false;
                    }
                    
                    // Show success feedback
                    if (!autosaveToast) {
                        autosaveToast = new bootstrap.Toast(domElements.autosaveToast, {
                            animation: true,
                            autohide: true,
                            delay: 2000
                        });
                    }
                    const toastBody = domElements.autosaveToast.querySelector('.toast-body span');
                    toastBody.textContent = 'OpenRouter API key updated!';
                    autosaveToast.show();
                } else {
                    console.error('Error updating OpenRouter token:', data.error);
                    alert('Error updating OpenRouter API key: ' + (data.error || 'Unknown error'));
                }
            })
            .catch(error => {
                console.error('Error updating OpenRouter token:', error);
                alert('Error updating OpenRouter API key: ' + error.message);
            });
            
            // Remove the OpenRouter API key from the form data so it doesn't get saved in settings
            formData.delete('openrouter_api_key');
        }
        
        fetch('/settings', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update window.config
                window.config = Object.assign(window.config || {}, {
                    model: formData.get('model'),
                    temperature: parseFloat(formData.get('temperature')),
                    min_p: parseFloat(formData.get('min_p')),
                    presence_penalty: parseFloat(formData.get('presence_penalty')),
                    repetition_penalty: parseFloat(formData.get('repetition_penalty')),
                    max_tokens: parseInt(formData.get('max_tokens')),
                    dark_mode: formData.get('dark_mode') === 'on',
                    provider: formData.get('provider'),
                    custom_api_key: formData.get('custom_api_key'),
                    openai_endpoint: formData.get('openai_endpoint'),
                    embeddings_search: formData.get('embeddings_search') === 'on'
                });
                
                // Editor colors now handled by CSS variables automatically
                
                // Silent auto-save (no toast)
            }
        })
        .catch(error => {
            console.error('Error auto-saving settings:', error);
        });
    }
    
    // Debounced auto-save (wait 500ms after last change)
    const debouncedAutoSave = debounce(autoSaveSettings, 500);
    
    // Dark mode toggle - immediate feedback and auto-save
    const darkModeToggle = document.getElementById('dark_mode');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', function() {
            if (this.checked) {
                // Dark mode enabled (remove light-mode class)
                document.body.classList.remove('light-mode');
            } else {
                // Light mode enabled (add light-mode class)
                document.body.classList.add('light-mode');
            }
            // Editor colors handled by CSS variables automatically
            
            // Auto-save immediately for dark mode toggle
            autoSaveSettings();
        });
    }
    
    // Embeddings search toggle - trigger re-search if search is active
    const embeddingsSearchToggle = document.getElementById('embeddings_search');
    if (embeddingsSearchToggle) {
        embeddingsSearchToggle.addEventListener('change', function() {
            // Auto-save immediately
            autoSaveSettings();
            
            // Re-search if there's an active search query
            if (domElements.documentSearch && domElements.documentSearch.value.trim()) {
                const query = domElements.documentSearch.value.trim();
                searchDocuments(query);
            }
        });
    }
    
    // Auto-save for all form inputs
    domElements.settingsFormInline.addEventListener('input', debouncedAutoSave);
    domElements.settingsFormInline.addEventListener('change', debouncedAutoSave);
    
    // Provider change handler
    const providerSelect = document.getElementById('provider');
    if (providerSelect) {
        providerSelect.addEventListener('change', function() {
            updateModelExamples();
            debouncedAutoSave();
        });
        
        // Initialize model examples on page load
        updateModelExamples();
    }
    
    // Main model input change handler
    const mainModelInput = document.getElementById('model-main');
    if (mainModelInput) {
        mainModelInput.addEventListener('input', function() {
            // Sync to advanced field if it exists
            syncModelFields('model-main', 'model');
            debouncedAutoSave();
        });
    }
    
    // Advanced model input change handler
    const modelInput = document.getElementById('model');
    if (modelInput) {
        modelInput.addEventListener('input', function() {
            // Sync to main field if accordion is open
            const accordion = document.getElementById('advancedCollapse');
            if (accordion && accordion.classList.contains('show')) {
                syncModelFields('model', 'model-main');
            }
            debouncedAutoSave();
        });
    }
    
    // Accordion event listeners
    const accordionElement = document.getElementById('advancedCollapse');
    if (accordionElement) {
        accordionElement.addEventListener('shown.bs.collapse', function() {
            handleAccordionToggle(true);
        });
        
        accordionElement.addEventListener('hidden.bs.collapse', function() {
            handleAccordionToggle(false);
        });
        
        // Initialize state based on current accordion state
        const isOpen = accordionElement.classList.contains('show');
        handleAccordionToggle(isOpen);
    }
    
    // Ctrl+S handler to show "Autosaved on edit" toast
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault(); // Prevent browser's default save dialog
            
            // Show "Autosaved on edit" toast
            if (!autosaveToast) {
                autosaveToast = new bootstrap.Toast(domElements.autosaveToast, {
                    animation: true,
                    autohide: true,
                    delay: 2000
                });
            }
            // Update toast message for Ctrl+S
            const toastBody = domElements.autosaveToast.querySelector('.toast-body span');
            toastBody.textContent = 'Autosaved on edit';
            autosaveToast.show();
        }
    });
    
    // Settings form submission (now handled by auto-save, but keep for manual saves if needed)
    domElements.settingsFormInline.addEventListener('submit', function(e) {
        e.preventDefault();
        // Just trigger auto-save function
        autoSaveSettings();
    });
    
    // Update displayed values for range inputs
    const rangeInputs = domElements.settingsFormInline.querySelectorAll('input[type="range"]');
    rangeInputs.forEach(input => {
        const valueInput = document.getElementById(`${input.id}-value`);
        
        // Sync range to number input
        input.addEventListener('input', function() {
            if (valueInput) {
                valueInput.value = input.value;
            }
        });
        
        // Sync number input to range
        if (valueInput) {
            valueInput.addEventListener('input', function() {
                input.value = this.value;
            });
            
            // Update on blur to ensure valid values
            valueInput.addEventListener('blur', function() {
                const min = parseFloat(this.min);
                const max = parseFloat(this.max);
                let value = parseFloat(this.value);
                
                if (isNaN(value)) value = parseFloat(input.value);
                if (value < min) value = min;
                if (value > max) value = max;
                
                this.value = value;
                input.value = value;
            });
        }
    });
    
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
    
    // New document button handlers - create documents directly as "Untitled"
    domElements.newDocumentBtn.addEventListener('click', function() {
        createNewDocument('Untitled');
    });
    
    domElements.emptyNewDocBtn.addEventListener('click', function() {
        createNewDocument('Untitled');
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
    isMobile = window.innerWidth <= 1000;
    
    // Reset sidebar state when switching between mobile and desktop
    if (wasMobile !== isMobile) {
        closeMobileSidebar();
        closeMobileSettingsSidebar();
    }
});

function toggleMobileSidebar() {
    domElements.sidebar.classList.toggle('show');
    document.body.classList.toggle('sidebar-open');
    domElements.sidebarBackdrop.classList.toggle('show');
}

function closeMobileSidebar() {
    domElements.sidebar.classList.remove('show');
    document.body.classList.remove('sidebar-open');
    domElements.sidebarBackdrop.classList.remove('show');
}

function toggleMobileSettingsSidebar() {
    domElements.settingsSidebar.classList.toggle('show');
    document.body.classList.toggle('sidebar-open');
    domElements.sidebarBackdrop.classList.toggle('show');
}

function closeMobileSettingsSidebar() {
    domElements.settingsSidebar.classList.remove('show');
    document.body.classList.remove('sidebar-open');
    domElements.sidebarBackdrop.classList.remove('show');
}

// Close sidebar when selecting a document on mobile
domElements.documentList.addEventListener('click', (e) => {
    const documentItem = e.target.closest('.document-item');
    if (documentItem && isMobile) {
        closeMobileSidebar();
    }
});

// Close sidebars when clicking backdrop
domElements.sidebarBackdrop.addEventListener('click', function() {
    closeMobileSidebar();
    closeMobileSettingsSidebar();
});

// Initialize error toast
function initErrorToast() {
    errorToast = new bootstrap.Toast(domElements.errorToast, {
        animation: true,
        autohide: true,
        delay: 8000  // Longer delay for more detailed messages
    });
}

/**
 * Get user-friendly error message based on status code
 * @param {number} statusCode - HTTP status code
 * @returns {string} User-friendly error description
 */
function getErrorDescription(statusCode) {
    const errorDescriptions = {
        400: "Bad Request - Invalid parameters were sent to the API. Please check your model settings and try again.",
        401: "Invalid Credentials - Your API key is invalid, expired, or disabled. Please check your token in settings.",
        402: "Insufficient Credits - Your account or API key has run out of credits. Add more credits to your OpenRouter account and try again.",
        403: "Content Moderation - Your input was flagged by content moderation. Please modify your prompt and try again.",
        408: "Request Timeout - Your request took too long to process. Try with a shorter prompt or different model.",
        429: "Rate Limited - You're making requests too quickly. Please wait a moment and try again.",
        502: "Model Unavailable - The selected model is currently down or returned an invalid response. Try a different model.",
        503: "No Available Provider - No model provider meets your routing requirements. Try a different model or check your settings."
    };
    
    return errorDescriptions[statusCode] || `Unknown error (Status: ${statusCode})`;
}

/**
 * Parse status code from error message
 * @param {string} message - Error message
 * @returns {number|null} Parsed status code or null if not found
 */
function parseStatusCode(message) {
    // Look for patterns like "API error: 401" or "Status code: 429"
    const statusMatch = message.match(/(?:API error|Status(?:\s+code)?|error):\s*(\d{3})/i);
    if (statusMatch) {
        return parseInt(statusMatch[1]);
    }
    
    // Look for standalone status codes in message
    const codeMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
    if (codeMatch) {
        return parseInt(codeMatch[1]);
    }
    
    return null;
}

function showError(message) {
    if (!errorToast) {
        initErrorToast();
    }
    
    // Parse status code from message
    const statusCode = parseStatusCode(message);
    
    let displayMessage = message;
    
    if (statusCode) {
        const description = getErrorDescription(statusCode);
        displayMessage = `Error ${statusCode}: ${description}`;
    } else if (message.toLowerCase().includes('openai-compatible api connection error')) {
        displayMessage = "Local Server Connection Error - Cannot connect to your local server. Make sure it's running and the URL is correct.";
    } else if (message.toLowerCase().includes('openai-compatible api timeout')) {
        displayMessage = "Local Server Timeout - Your server took too long to respond. The model might be too large or the server is overloaded.";
    } else if (message.toLowerCase().includes('openai-compatible api error')) {
        displayMessage = "Local Server API Error - The server returned an error. Check the server logs for more details.";
    } else if (message.toLowerCase().includes('connection error')) {
        displayMessage = "Connection Error - Unable to connect to the API. Check your internet connection and try again.";
    } else if (message.toLowerCase().includes('all models failed')) {
        displayMessage = "All Models Failed - All available models returned errors. This may be a temporary issue with the API service.";
    }
    
    domElements.errorToastBody.textContent = displayMessage;
    errorToast.show();
}

function showAutoRenameToast(newName) {
    if (!autorenameToast) {
        autorenameToast = new bootstrap.Toast(domElements.autorenameToast, {
            animation: true,
            autohide: true,
            delay: 3000
        });
    }
    
    domElements.autorenameToastText.textContent = `Renamed to "${newName}"`;
    autorenameToast.show();
}