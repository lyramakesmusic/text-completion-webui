// ============================
// Global Variables
// ============================
let editor = null;
let currentDocument = null;
let currentGenerationId = null;
let lastContent = '';
let isMobile = window.innerWidth <= 1000;
let lastCheckpoint = null;  // Store the content checkpoint before generation
let errorToast = null;  // Store the toast instance
let autosaveToast = null;  // Store the autosave toast instance
let autorenameToast = null;  // Store the autorename toast instance
let duplicateToast = null;  // Store the duplicate toast instance
let settingsDirty = false;  // Track if settings have changed since last save
let suppressInputHandler = false;  // Prevent input handler during programmatic changes
let pendingDocumentLoad = null;  // Track which document is being loaded (prevent race conditions)
let documentContentCache = new Map();  // Cache document contents for instant switching

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
    headerDocumentName: document.getElementById('header-document-name'),
    submitBtn: document.getElementById('submit-btn'),
    cancelBtn: document.getElementById('cancel-btn'),
    rerollBtn: document.getElementById('reroll-btn'),
    copyAllBtn: document.getElementById('copy-all-btn'),
    duplicateBtn: document.getElementById('duplicate-btn'),
    seedBtn: document.getElementById('seed-btn'),
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
    duplicateToast: document.getElementById('duplicate-toast'),
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
    
    // Track content changes and auto-save after 2s of no typing (backend handles 30s max)
    editor.addEventListener('input', function() {
        if (!currentDocument || suppressInputHandler) return;
        
        const currentContent = editor.value;
        if (currentContent === lastContent) return;
        
        // Clear the checkpoint when user makes changes
        lastCheckpoint = null;
        
        // Update lastContent immediately to prevent duplicate saves
        lastContent = currentContent;
        
        // Cancel previous save timer and schedule new one (2s delay)
        if (window.saveTimer) {
            clearTimeout(window.saveTimer);
        }
        window.saveTimer = setTimeout(() => {
            saveCurrentDocument();
            window.saveTimer = null;
        }, 2000);  // 2s delay, backend handles 30s max during continuous typing
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
    
    // Update cache
    documentContentCache.set(currentDocument.id, currentDocument);
    
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
            
            // Preload first 50 documents for instant switching
            preloadDocuments(data.documents.slice(0, 50));

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
 * Preload documents into cache for instant switching (async, non-blocking)
 */
async function preloadDocuments(documents) {
    // Filter out already cached docs
    const docsToPreload = documents.filter(doc => !documentContentCache.has(doc.id));
    
    // Preload in small batches to avoid overwhelming the server
    const batchSize = 5;
    for (let i = 0; i < docsToPreload.length; i += batchSize) {
        const batch = docsToPreload.slice(i, i + batchSize);
        
        // Process batch in parallel
        await Promise.all(batch.map(async (doc) => {
            try {
                const response = await fetch(`/documents/${doc.id}`);
                const data = await response.json();
                if (data.success) {
                    documentContentCache.set(doc.id, data.document);
                }
            } catch (error) {
                console.error(`Error preloading document ${doc.id}:`, error);
            }
        }));
        
        // Small delay between batches to be nice to the server
        if (i + batchSize < docsToPreload.length) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
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
        <a href="/view/${doc.id}" class="document-link">
            <div class="document-name">${doc.name}</div>
            <span class="document-time">${timeOrMetric}</span>
        </a>
        <div class="document-actions dropdown ms-2" data-id="${doc.id}" data-name="${doc.name}">
            <i class="bi bi-three-dots" data-bs-toggle="dropdown"></i>
            <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item download-doc" href="#" data-id="${doc.id}" data-name="${doc.name}">Download as .txt</a></li>
                <li><a class="dropdown-item duplicate-doc" href="#" data-id="${doc.id}" data-name="${doc.name}">Duplicate</a></li>
                <li><a class="dropdown-item rename-doc" href="#" data-id="${doc.id}" data-name="${doc.name}">Rename</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item delete-doc text-danger" href="#" data-id="${doc.id}" data-name="${doc.name}">Delete</a></li>
            </ul>
        </div>
    `;
    
    // Handle link clicks - prevent default for left-click, allow middle/ctrl-click to open new tab
    const link = li.querySelector('.document-link');
    link.addEventListener('click', function(e) {
        // Allow middle-click (button 1) and ctrl/cmd-click to open in new tab naturally
        if (e.button === 1 || e.ctrlKey || e.metaKey) {
            return; // Let the browser handle it
        }
        
        // For normal left-click, prevent default and load via AJAX
        e.preventDefault();
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

    document.querySelectorAll('.duplicate-doc').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation(); // Prevent the click from reaching the document item
            const docId = this.dataset.id;
            const docName = this.dataset.name;
            duplicateDocumentFromSidebar(docId, docName);
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
    // Mark this as the pending load to prevent race conditions
    pendingDocumentLoad = docId;
    
    // Get document name from sidebar for immediate feedback
    const docElement = document.querySelector(`.document-item[data-id="${docId}"]`);
    const docName = docElement ? docElement.querySelector('.document-name')?.textContent : 'Loading...';
    
    // Update UI immediately for instant feedback
    hideEmptyState();
    highlightActiveDocument(docId);
    updateCurrentDocumentName(docName);
    
    // Check cache first for instant loading
    if (documentContentCache.has(docId)) {
        const cachedDoc = documentContentCache.get(docId);
        applyDocumentToEditor(docId, cachedDoc);
        
        // Still fetch in background to get any updates
        fetchAndCacheDocument(docId, true);
    } else {
        // Not cached, fetch it
        fetchAndCacheDocument(docId, false);
    }
    
    // Set current document on server asynchronously (don't wait)
    fetch(`/documents/${docId}/set-current`, {
        method: 'POST'
    }).catch(error => {
        console.error('Error setting current document:', error);
    });
}

/**
 * Fetch document and update cache
 */
function fetchAndCacheDocument(docId, isBackgroundUpdate) {
    fetch(`/documents/${docId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Cache the document
                documentContentCache.set(docId, data.document);
                
                // Only apply if this is still the document we want to load (race condition check)
                if (pendingDocumentLoad === docId && !isBackgroundUpdate) {
                    applyDocumentToEditor(docId, data.document);
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
 * Apply document content to editor (race-condition safe)
 */
function applyDocumentToEditor(docId, document) {
    // Final race condition check
    if (pendingDocumentLoad !== docId) {
        return; // User switched to different document, ignore this
    }
    
    currentDocument = document;
    
    // Update document name
    updateCurrentDocumentName(currentDocument.name);
    
    // Initialize or update editor with document content
    if (!editor) {
        initEditor();
    }
    
    // Set editor content and update lastContent
    const content = currentDocument.content || '';
    if (editor.value !== content) {
        suppressInputHandler = true;
        editor.value = content;
        lastContent = content;
        suppressInputHandler = false;
    }
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
            // Update cache
            if (documentContentCache.has(docId)) {
                const cachedDoc = documentContentCache.get(docId);
                cachedDoc.name = newName;
                documentContentCache.set(docId, cachedDoc);
            }
            
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
 * Duplicate a document from sidebar (doesn't switch to it)
 * @param {String} docId - Document ID to duplicate
 * @param {String} docName - Document name
 */
function duplicateDocumentFromSidebar(docId, docName) {
    fetch(`/documents/${docId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const content = data.document.content || '';
                const newName = `${docName} (copy)`;
                
                fetch('/documents/new', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        'name': newName,
                        'content': content
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        loadDocuments();
                    } else {
                        console.error('Error creating duplicate:', data.error);
                    }
                })
                .catch(error => {
                    console.error('Error creating duplicate:', error);
                });
            } else {
                console.error('Error fetching document:', data.error);
            }
        })
        .catch(error => {
            console.error('Error fetching document:', error);
        });
}

/**
 * Delete a document
 * @param {String} docId - Document ID to delete
 */
function deleteDocument(docId) {
    // Check if we're deleting the current document
    const isDeletingCurrentDoc = currentDocument && currentDocument.id === docId;
    
    // Remove from cache
    documentContentCache.delete(docId);
    
    fetch(`/documents/${docId}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // If we deleted the current document, create a new blank one
            if (isDeletingCurrentDoc) {
                deleteEmptyUntitledDocuments().then(() => {
                    createNewDocument('Untitled');
                });
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

/**
 * Delete all empty "Untitled" documents
 */
async function deleteEmptyUntitledDocuments() {
    try {
        const response = await fetch('/documents');
        const data = await response.json();
        
        if (!data.success || !data.documents) return;
        
        // Find all "Untitled" docs that are empty
        const emptyUntitled = data.documents.filter(doc => {
            const cachedDoc = documentContentCache.get(doc.id);
            const content = cachedDoc ? cachedDoc.content : doc.content;
            return doc.name === 'Untitled' && (!content || content.trim() === '');
        });
        
        // Fetch and check uncached documents
        const uncachedDocs = emptyUntitled.filter(doc => !documentContentCache.has(doc.id));
        for (const doc of uncachedDocs) {
            const docResponse = await fetch(`/documents/${doc.id}`);
            const docData = await docResponse.json();
            if (docData.success) {
                const content = docData.document.content || '';
                if (content.trim() !== '') {
                    // Not empty, remove from deletion list
                    const idx = emptyUntitled.findIndex(d => d.id === doc.id);
                    if (idx >= 0) emptyUntitled.splice(idx, 1);
                }
            }
        }
        
        // Delete all empty "Untitled" documents
        await Promise.all(emptyUntitled.map(doc => {
            documentContentCache.delete(doc.id);
            return fetch(`/documents/${doc.id}`, { method: 'DELETE' });
        }));
    } catch (error) {
        console.error('Error deleting empty Untitled documents:', error);
    }
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
            
            // Update lastContent to prevent input handler from triggering
            // Backend will save immediately after generation completes
            lastContent = originalText + generatedText;
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
            const mobileHeaderNameElement = document.getElementById('header-document-name');
            if (mobileHeaderNameElement) {
                mobileHeaderNameElement.textContent = data.new_name;
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
            
            // Save final content to backend before backend writes to disk
            saveCurrentDocument();
            
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
            
            // Save any partial content before closing
            if (editor.value !== lastCheckpoint) {
                saveCurrentDocument();
            }
            
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
            // Save partial content before backend writes to disk
            saveCurrentDocument();
            
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
        
        // Save any partial content before closing
        if (editor.value !== lastCheckpoint) {
            saveCurrentDocument();
        }
        
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
    
    // Document name scroll gradient fade
    function updateDocumentNameGradient(el) {
        if (!el) return;
        const hasOverflow = el.scrollWidth > el.clientWidth;
        
        if (!hasOverflow) {
            el.style.setProperty('--fade-left-opacity', '1');
            el.style.setProperty('--fade-right-opacity', '1');
            return;
        }
        
        const scrollLeft = el.scrollLeft;
        const scrollRight = el.scrollWidth - el.clientWidth - scrollLeft;
        const fadeDistance = 40;
        
        const leftOpacity = 1 - Math.min(scrollLeft / fadeDistance, 1);
        const rightOpacity = 1 - Math.min(scrollRight / fadeDistance, 1);
        
        el.style.setProperty('--fade-left-opacity', leftOpacity);
        el.style.setProperty('--fade-right-opacity', rightOpacity);
    }
    
    [domElements.currentDocumentName, domElements.headerDocumentName].forEach(el => {
        if (!el) return;
        el.addEventListener('scroll', () => updateDocumentNameGradient(el));
        const observer = new MutationObserver(() => updateDocumentNameGradient(el));
        observer.observe(el, { childList: true, characterData: true, subtree: true });
        updateDocumentNameGradient(el);
    });
    
    // Recheck on window resize
    window.addEventListener('resize', () => {
        [domElements.currentDocumentName, domElements.headerDocumentName].forEach(el => {
            if (el) updateDocumentNameGradient(el);
        });
    });
    
    // Smart model/endpoint detection and parsing
    function detectProviderFromInput(value) {
        if (!value || !value.trim()) {
            return { provider: 'openrouter', model: '', endpoint: '' };
        }
        
        const trimmedValue = value.trim();
        
        // Check if it starts with http:// or https:// (OpenAI-compatible endpoint)
        if (trimmedValue.startsWith('http://') || trimmedValue.startsWith('https://')) {
            return { 
                provider: 'openai', 
                model: '', 
                endpoint: trimmedValue 
            };
        }
        
        // Otherwise assume it's an OpenRouter model (provider/model format)
        return { 
            provider: 'openrouter', 
            model: trimmedValue, 
            endpoint: '' 
        };
    }
    
    function updateProviderFields(detection) {
        // Update hidden fields for backend
        const providerField = document.getElementById('provider');
        const endpointField = document.getElementById('openai_endpoint');
        const detectedSpan = document.getElementById('provider-detected');
        const apiKeySection = document.querySelector('#api_key').closest('.mb-4');
        const apiKeyHelp = document.getElementById('api-key-help');
        
        if (providerField) providerField.value = detection.provider;
        if (endpointField) endpointField.value = detection.endpoint;
        
        // Update UI feedback
        if (detectedSpan) {
            detectedSpan.textContent = detection.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI-Compatible';
        }
        
        // Show/hide API key field based on provider
        if (apiKeySection) {
            if (detection.provider === 'openrouter') {
                apiKeySection.style.display = 'block';
                if (apiKeyHelp) {
                    apiKeyHelp.textContent = 'Your OpenRouter API key (will update saved token)';
                }
            } else {
                apiKeySection.style.display = 'none';
            }
        }
    }
    
    function handleModelEndpointChange() {
        const modelEndpointField = document.getElementById('model-endpoint');
        if (!modelEndpointField) return;
        
        const detection = detectProviderFromInput(modelEndpointField.value);
        updateProviderFields(detection);
        
        // Always keep the name as 'model' for form submission
        modelEndpointField.setAttribute('name', 'model');
        
        // Update the hidden fields immediately
        const providerField = document.getElementById('provider');
        const endpointField = document.getElementById('openai_endpoint');
        
        if (providerField) providerField.value = detection.provider;
        if (endpointField) endpointField.value = detection.endpoint;
    }
    
    // Auto-save settings function
    function autoSaveSettings(force = false) {
        // Skip if settings haven't changed (unless forced)
        if (!force && !settingsDirty) {
            return;
        }
        
        const formData = new FormData(domElements.settingsFormInline);
        
        // Get the current detection to handle API keys correctly
        const modelEndpointField = document.getElementById('model-endpoint');
        const detection = detectProviderFromInput(modelEndpointField ? modelEndpointField.value : '');
        
        // The hidden fields are already updated by handleModelEndpointChange
        // Just ensure form data reflects the correct values
        if (detection.provider === 'openrouter') {
            formData.set('model', detection.model);
            formData.set('openai_endpoint', ''); // Clear endpoint for OpenRouter
        } else if (detection.provider === 'openai') {
            formData.set('model', ''); // No model needed for OpenAI-compatible
            formData.set('openai_endpoint', detection.endpoint);
        }
        
        // Handle API key updates based on provider
        const apiKey = formData.get('openrouter_api_key');
        if (apiKey && apiKey.trim()) {
            if (detection.provider === 'openrouter') {
                // Update the main OpenRouter token
                fetch('/set_token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        'token': apiKey.trim()
                    })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        // Clear the field after successful save
                        document.getElementById('api_key').value = '';
                        
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
                        toastBody.textContent = 'API key updated!';
                        autosaveToast.show();
                    } else {
                        console.error('Error updating API token:', data.error);
                        alert('Error updating API key: ' + (data.error || 'Unknown error'));
                    }
                })
                .catch(error => {
                    console.error('Error updating API token:', error);
                    alert('Error updating API key: ' + error.message);
                });
            } else {
                // For OpenAI-compatible, store as custom API key
                formData.set('custom_api_key', apiKey.trim());
                // Clear the field after saving
                setTimeout(() => {
                    document.getElementById('api_key').value = '';
                }, 100);
            }
            
            // Remove from form data for OpenRouter (already handled above)
            if (detection.provider === 'openrouter') {
                formData.delete('openrouter_api_key');
            }
        }
        
        fetch('/settings', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update window.config with the detected values
                window.config = Object.assign(window.config || {}, {
                    model: formData.get('model'),
                    temperature: parseFloat(formData.get('temperature')),
                    min_p: parseFloat(formData.get('min_p')),
                    presence_penalty: parseFloat(formData.get('presence_penalty')),
                    repetition_penalty: parseFloat(formData.get('repetition_penalty')),
                    max_tokens: parseInt(formData.get('max_tokens')),
                    dark_mode: formData.get('dark_mode') === 'on',
                    provider: detection.provider,
                    custom_api_key: formData.get('custom_api_key'),
                    openai_endpoint: formData.get('openai_endpoint'),
                    embeddings_search: formData.get('embeddings_search') === 'on'
                });
                
                // Mark settings as clean after save
                settingsDirty = false;
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
    domElements.settingsFormInline.addEventListener('input', function() {
        settingsDirty = true;
        debouncedAutoSave();
    });
    domElements.settingsFormInline.addEventListener('change', function() {
        settingsDirty = true;
        debouncedAutoSave();
    });
    
    // Model/Endpoint input change handler - this is the main smart input
    const modelEndpointInput = document.getElementById('model-endpoint');
    if (modelEndpointInput) {
        modelEndpointInput.addEventListener('input', function() {
            handleModelEndpointChange();
            debouncedAutoSave();
        });
        
        // Initialize on page load based on current config
        if (window.config) {
            let initialValue = '';
            if (window.config.provider === 'openai' && window.config.openai_endpoint) {
                initialValue = window.config.openai_endpoint;
            } else if (window.config.model) {
                initialValue = window.config.model;
            }
            
            if (initialValue) {
                modelEndpointInput.value = initialValue;
                handleModelEndpointChange();
            }
        }
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
        
        // Ensure settings are saved with current accordion values before generation
        // This guarantees the generation uses the selected provider/model
        autoSaveSettings();
        
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
    
    // Add copy all button handler (mobile only)
    if (domElements.copyAllBtn) {
        domElements.copyAllBtn.addEventListener('click', async function() {
            if (!editor) return;
            
            try {
                // Use Clipboard API for reliable copying of entire content
                await navigator.clipboard.writeText(editor.value);
                
                // Visual feedback
                const originalHTML = this.innerHTML;
                this.innerHTML = '<i class="bi bi-check"></i>';
                setTimeout(() => {
                    this.innerHTML = originalHTML;
                }, 1000);
            } catch (err) {
                // Fallback: select all and copy
                editor.select();
                document.execCommand('copy');
                console.error('Clipboard API failed, used fallback:', err);
            }
        });
    }
    
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
    
    // Autorename button in rename modal
    document.getElementById('autorename-btn').addEventListener('click', async function() {
        const docId = document.getElementById('rename-document-id').value;
        const nameInput = document.getElementById('rename-document-input');
        
        if (!docId) return;
        
        // Disable button while generating
        this.disabled = true;
        const originalText = this.textContent;
        this.textContent = 'Generating...';
        
        try {
            // Get current document content
            const docResponse = await fetch(`/documents/${docId}`);
            const docData = await docResponse.json();
            
            if (docData.success && docData.document && docData.document.content) {
                // Generate name from content
                const response = await fetch('/generate_name', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        content: docData.document.content
                    })
                });
                
                const data = await response.json();
                if (data.success && data.name) {
                    nameInput.value = data.name;
                    nameInput.select();
                }
            }
        } catch (error) {
            console.error('Error generating name:', error);
        } finally {
            this.disabled = false;
            this.textContent = originalText;
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
        
        // Restore editor to checkpoint and save (removes generated text)
        suppressInputHandler = true;
        editor.value = lastCheckpoint;
        lastContent = lastCheckpoint;
        suppressInputHandler = false;
        saveCurrentDocument(); // Must save to sync reverted state to backend
        
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

    // Duplicate in new document button handler
    domElements.duplicateBtn.addEventListener('click', function() {
        if (!currentDocument || !editor) return;
        
        const content = editor.value;
        const originalName = currentDocument.name;
        const newName = `${originalName} (copy)`;
        
        fetch('/documents/new', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'name': newName,
                'content': content
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const newDoc = data.document;
                
                // Update current document state immediately (no visual change, just metadata swap)
                currentDocument = newDoc;
                lastContent = content;
                pendingDocumentLoad = newDoc.id;
                
                // HERE - show empty doc for 0.1s
                showEmptyState();
                setTimeout(() => {
                    hideEmptyState();
                }, 100);
                
                // Cache the new document
                documentContentCache.set(newDoc.id, newDoc);
                
                // Update document name in UI
                updateCurrentDocumentName(newDoc.name);
                
                // Refresh sidebar list in background and highlight new doc
                fetch('/documents')
                    .then(response => response.json())
                    .then(listData => {
                        if (listData.success) {
                            renderDocumentList(listData.documents, newDoc.id);
                        }
                    });
                
                // Set as current on server
                fetch(`/documents/${newDoc.id}/set-current`, {
                    method: 'POST'
                }).catch(error => console.error('Error setting current document:', error));
                
                // Show duplicate toast (always recreate for reliable autohide)
                if (duplicateToast) {
                    duplicateToast.dispose();
                }
                duplicateToast = new bootstrap.Toast(domElements.duplicateToast, {
                    animation: true,
                    autohide: true,
                    delay: 3000
                });
                duplicateToast.show();
            } else {
                console.error('Error duplicating document:', data.error);
            }
        })
        .catch(error => {
            console.error('Error duplicating document:', error);
        });
    });

    // Seed button handler - generates starter text
    domElements.seedBtn.addEventListener('click', async function() {
        if (!editor || !currentDocument) return;
        
        const currentContent = editor.value.trim();
        if (currentContent.length >= 1000) {
            if (!confirm('This will replace your entire document. Are you sure?')) {
                return;
            }
        }
        
        // Always rename to "Untitled" when using seed button (wait for it to complete)
        if (currentDocument.name !== 'Untitled') {
            try {
                const response = await fetch(`/documents/${currentDocument.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        name: 'Untitled'
                    })
                });
                const data = await response.json();
                if (data.success && data.document) {
                    currentDocument = data.document;
                    updateDocumentNameDisplay();
                }
            } catch (error) {
                console.error('Error renaming to Untitled:', error);
            }
        }
        
        // Cancel any active generation first
        if (currentGenerationId) {
            fetch('/cancel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    generation_id: currentGenerationId
                })
            });
            
            if (window.currentEventSource) {
                window.currentEventSource.close();
                window.currentEventSource = null;
            }
            
            currentGenerationId = null;
            domElements.submitBtn.disabled = false;
            domElements.submitBtn.style.display = 'block';
            domElements.cancelBtn.style.display = 'none';
        }
        
        // Clear editor and save checkpoint
        suppressInputHandler = true;
        editor.value = '';
        lastContent = '';
        lastCheckpoint = '';
        suppressInputHandler = false;
        saveCurrentDocument();
        
        // Start seed generation - same as clicking complete button
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
    domElements.headerDocumentName.textContent = name;
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
    domElements.headerDocumentName.textContent = '';
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