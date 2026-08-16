document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const chatForm = document.getElementById('chatForm');
    const userInput = document.getElementById('userInput');
    const chatHistory = document.getElementById('chatHistory');
    const clearBtn = document.getElementById('clearBtn');
    const sendBtn = document.getElementById('sendBtn');
    
    // Document Upload Elements
    const uploadBtn = document.getElementById('uploadBtn');
    const fileUpload = document.getElementById('fileUpload');
    const uploadStatus = document.getElementById('uploadStatus');
    const documentList = document.getElementById('documentList');
    const docCountBadge = document.getElementById('docCountBadge');
    
    // Notes Panel & Modal Elements
    const notesPanel = document.getElementById('notesPanel');
    const toggleNotesPanelBtn = document.getElementById('toggleNotesPanelBtn');
    const notesGrid = document.getElementById('notesGrid');
    const notesCountBadge = document.getElementById('notesCountBadge');
    const newNoteBtn = document.getElementById('newNoteBtn');
    const exportNotesBtn = document.getElementById('exportNotesBtn');
    const noteSearchInput = document.getElementById('noteSearchInput');
    const tagChips = document.getElementById('tagChips');
    
    // Modal Elements
    const noteModal = document.getElementById('noteModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalNoteId = document.getElementById('modalNoteId');
    const noteTitleInput = document.getElementById('noteTitleInput');
    const noteTagSelect = document.getElementById('noteTagSelect');
    const noteContentInput = document.getElementById('noteContentInput');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelNoteBtn = document.getElementById('cancelNoteBtn');
    const saveNoteBtn = document.getElementById('saveNoteBtn');

    // State Variables
    let notesState = [];
    let currentTagFilter = 'ALL';
    let currentSearchQuery = '';

    // ==========================================
    // 1. DOCUMENTS MANAGEMENT
    // ==========================================
    const loadDocuments = async () => {
        try {
            const response = await fetch('/api/documents');
            const data = await response.json();
            documentList.innerHTML = '';
            
            const docs = data.documents || [];
            docCountBadge.textContent = `${docs.length} DOCS LOADED`;
            
            if (docs.length === 0) {
                documentList.innerHTML = '<li style="color:var(--text-muted);">No documents loaded yet.</li>';
                return;
            }

            docs.forEach(doc => {
                const li = document.createElement('li');
                const icon = doc.endsWith('.pdf') ? 'fa-file-pdf' : 'fa-file-code';
                li.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${doc}</span>`;
                documentList.appendChild(li);
            });
        } catch (error) {
            console.error('Failed to load documents:', error);
            documentList.innerHTML = '<li style="color:#EF4444;">Failed to load sources</li>';
        }
    };

    uploadBtn.addEventListener('click', () => fileUpload.click());

    fileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        uploadBtn.disabled = true;
        uploadStatus.style.color = 'var(--text-accent)';
        uploadStatus.textContent = `UPLOADING: ${file.name}...`;

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Upload failed');
            
            uploadStatus.style.color = '#10B981';
            uploadStatus.textContent = `SUCCESSFULLY PROCESSED ${file.name}`;
            await loadDocuments();
            
            appendMessage(`System: Uploaded and embedded **${file.name}**. You can now query its contents!`, false, 'SYSTEM');
        } catch (error) {
            console.error('Upload error:', error);
            uploadStatus.style.color = '#EF4444';
            uploadStatus.textContent = 'UPLOAD FAILED';
        } finally {
            uploadBtn.disabled = false;
            fileUpload.value = '';
            setTimeout(() => { uploadStatus.textContent = ''; }, 4000);
        }
    });

    // ==========================================
    // 2. SHORT NOTES MANAGEMENT & RENDER
    // ==========================================
    const loadNotes = async () => {
        try {
            const response = await fetch('/api/notes');
            const data = await response.json();
            notesState = data.notes || [];
            renderNotes();
        } catch (error) {
            console.error('Failed to load notes:', error);
        }
    };

    const renderNotes = () => {
        notesGrid.innerHTML = '';
        
        // Filter notes by tag and search query
        let filtered = notesState.filter(note => {
            const matchesTag = (currentTagFilter === 'ALL') || 
                               (note.tags && note.tags.includes(currentTagFilter)) ||
                               (note.tag === currentTagFilter);
            
            const matchesSearch = !currentSearchQuery || 
                                  note.title.toLowerCase().includes(currentSearchQuery.toLowerCase()) || 
                                  note.content.toLowerCase().includes(currentSearchQuery.toLowerCase());
            return matchesTag && matchesSearch;
        });

        // Sort pinned notes first
        filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

        notesCountBadge.textContent = notesState.length;

        if (filtered.length === 0) {
            notesGrid.innerHTML = `
                <div style="padding: 24px; text-align: center; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.8rem; border: 1px dashed var(--border-color);">
                    <i class="fa-solid fa-note-sticky" style="font-size: 1.8rem; margin-bottom: 8px; color: var(--border-color);"></i>
                    <p>NO SHORT NOTES FOUND</p>
                    <span style="font-size: 0.72rem;">Click "Save as Note" on AI answers or "NEW NOTE" above.</span>
                </div>
            `;
            return;
        }

        filtered.forEach(note => {
            const card = document.createElement('div');
            card.className = `note-card ${note.pinned ? 'pinned' : ''}`;
            card.dataset.id = note.id;

            const primaryTag = (note.tags && note.tags[0]) || note.tag || 'INSIGHT';
            const timestamp = note.timestamp || 'Just now';

            card.innerHTML = `
                <div class="note-card-header">
                    <span class="note-title">${escapeHtml(note.title)}</span>
                    <span class="note-tag" data-tag="${primaryTag}">${primaryTag}</span>
                </div>
                <div class="note-card-body">
                    <p>${formatMarkdownSnippet(note.content)}</p>
                </div>
                <div class="note-card-footer">
                    <span><i class="fa-regular fa-clock"></i> ${timestamp}</span>
                    <div class="note-card-actions">
                        <button class="icon-btn ${note.pinned ? 'pinned' : ''}" onclick="togglePinNote('${note.id}')" title="${note.pinned ? 'Unpin note' : 'Pin note'}">
                            <i class="fa-solid fa-thumbtack"></i>
                        </button>
                        <button class="icon-btn" onclick="openEditNoteModal('${note.id}')" title="Edit Note">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="icon-btn" onclick="copyToClipboard(\`${escapeForJs(note.content)}\`, this)" title="Copy text">
                            <i class="fa-solid fa-copy"></i>
                        </button>
                        <button class="icon-btn danger" onclick="deleteNote('${note.id}')" title="Delete Note">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
            notesGrid.appendChild(card);
        });
    };

    // Filter Chips Event Listener
    tagChips.addEventListener('click', (e) => {
        if (e.target.classList.contains('tag-chip')) {
            document.querySelectorAll('.tag-chip').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            currentTagFilter = e.target.dataset.tag;
            renderNotes();
        }
    });

    // Search Input Event Listener
    noteSearchInput.addEventListener('input', (e) => {
        currentSearchQuery = e.target.value.trim();
        renderNotes();
    });

    // Toggle Notes Right Panel
    toggleNotesPanelBtn.addEventListener('click', () => {
        notesPanel.classList.toggle('collapsed');
        toggleNotesPanelBtn.classList.toggle('active');
    });

    // Modal Controls
    const openModal = (isEdit = false, noteData = null) => {
        noteModal.classList.add('active');
        if (isEdit && noteData) {
            modalTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> EDIT SHORT NOTE CARD';
            modalNoteId.value = noteData.id;
            noteTitleInput.value = noteData.title;
            noteTagSelect.value = (noteData.tags && noteData.tags[0]) || noteData.tag || 'INSIGHT';
            noteContentInput.value = noteData.content;
        } else {
            modalTitle.innerHTML = '<i class="fa-solid fa-note-sticky"></i> CREATE SHORT NOTE CARD';
            modalNoteId.value = '';
            noteTitleInput.value = '';
            noteTagSelect.value = 'INSIGHT';
            noteContentInput.value = noteData ? noteData.content || '' : '';
        }
    };

    const closeModal = () => {
        noteModal.classList.remove('active');
    };

    newNoteBtn.addEventListener('click', () => openModal(false));
    closeModalBtn.addEventListener('click', closeModal);
    cancelNoteBtn.addEventListener('click', closeModal);

    saveNoteBtn.addEventListener('click', async () => {
        const title = noteTitleInput.value.trim() || 'Untitled Short Note';
        const tag = noteTagSelect.value;
        const content = noteContentInput.value.trim();
        const id = modalNoteId.value;

        if (!content) {
            alert('Please enter note content');
            return;
        }

        const payload = {
            title,
            content,
            tags: [tag],
            pinned: false
        };

        try {
            if (id) {
                // Update existing
                await fetch(`/api/notes/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                // Create new
                await fetch('/api/notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }
            closeModal();
            await loadNotes();
            // Ensure notes panel is open to see the new card
            notesPanel.classList.remove('collapsed');
            toggleNotesPanelBtn.classList.add('active');
        } catch (error) {
            console.error('Failed to save note card:', error);
        }
    });

    // Global Window Helpers for Note Card inline actions
    window.openEditNoteModal = (id) => {
        const note = notesState.find(n => n.id === id);
        if (note) openModal(true, note);
    };

    window.deleteNote = async (id) => {
        if (confirm('Delete this short note card?')) {
            try {
                await fetch(`/api/notes/${id}`, { method: 'DELETE' });
                await loadNotes();
            } catch (error) {
                console.error('Failed to delete note:', error);
            }
        }
    };

    window.togglePinNote = async (id) => {
        const note = notesState.find(n => n.id === id);
        if (!note) return;
        try {
            await fetch(`/api/notes/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...note, pinned: !note.pinned })
            });
            await loadNotes();
        } catch (error) {
            console.error('Failed to pin note:', error);
        }
    };

    window.saveTextAsNoteCard = (text, defaultTitle = 'Saved Insight') => {
        openModal(false, {
            title: defaultTitle.substring(0, 40),
            content: text
        });
    };

    window.copyToClipboard = (text, btnElement) => {
        navigator.clipboard.writeText(text).then(() => {
            const original = btnElement.innerHTML;
            btnElement.innerHTML = '<i class="fa-solid fa-check" style="color:#10B981;"></i>';
            setTimeout(() => { btnElement.innerHTML = original; }, 1500);
        });
    };

    // Export Notes Functionality
    exportNotesBtn.addEventListener('click', () => {
        if (notesState.length === 0) {
            alert('No notes to export.');
            return;
        }

        let markdownContent = `# NOTEBOOKLM SHORT NOTES EXPORT\n*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;
        notesState.forEach((note, index) => {
            const tag = (note.tags && note.tags[0]) || note.tag || 'NOTE';
            markdownContent += `### ${index + 1}. [${tag}] ${note.title}\n`;
            markdownContent += `*Date: ${note.timestamp || 'N/A'}*\n\n`;
            markdownContent += `${note.content}\n\n---\n\n`;
        });

        const blob = new Blob([markdownContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `notebook_short_notes_${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ==========================================
    // 3. CHAT CANVAS & STREAMING
    // ==========================================
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (this.value.trim()) {
                if (typeof chatForm.requestSubmit === 'function') {
                    chatForm.requestSubmit();
                } else {
                    chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
                }
            }
        }
    });

    const scrollToBottom = () => {
        chatHistory.scrollTo({ top: chatHistory.scrollHeight, behavior: 'smooth' });
    };

    const appendMessage = (content, isUser = false, authorName = null) => {
        const block = document.createElement('div');
        block.className = `message-block ${isUser ? 'user-block' : 'ai-block'}`;

        const author = authorName || (isUser ? 'YOU' : 'NOTEBOOKLM');
        const icon = isUser ? 'fa-user' : 'fa-microchip';
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const formattedText = formatMarkdownSnippet(content);

        block.innerHTML = `
            <div class="block-header">
                <div class="author-tag"><i class="fa-solid ${icon}"></i> ${author}</div>
                <div class="time-tag">${timestamp}</div>
            </div>
            <div class="block-body">
                <p>${formattedText}</p>
            </div>
        `;

        if (!isUser) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'block-actions';
            actionsDiv.innerHTML = `
                <button class="btn btn-sharp btn-primary btn-sm save-note-action-btn">
                    <i class="fa-solid fa-bookmark"></i> SAVE AS NOTE CARD
                </button>
                <button class="btn btn-sharp btn-secondary btn-sm copy-action-btn">
                    <i class="fa-solid fa-copy"></i> COPY
                </button>
            `;

            actionsDiv.querySelector('.save-note-action-btn').addEventListener('click', () => {
                const text = block.querySelector('.block-body').innerText;
                saveTextAsNoteCard(text, `Insight: ${text.substring(0, 25)}...`);
            });

            actionsDiv.querySelector('.copy-action-btn').addEventListener('click', (e) => {
                const text = block.querySelector('.block-body').innerText;
                copyToClipboard(text, e.currentTarget);
            });

            block.appendChild(actionsDiv);
        }

        chatHistory.appendChild(block);
        scrollToBottom();
        return block;
    };

    const showTypingBlock = () => {
        const block = document.createElement('div');
        block.className = 'message-block ai-block';
        block.id = 'typingBlock';
        block.innerHTML = `
            <div class="block-header">
                <div class="author-tag"><i class="fa-solid fa-microchip"></i> NOTEBOOKLM</div>
                <div class="time-tag">RETRIEVING & GENERATING...</div>
            </div>
            <div class="block-body">
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        chatHistory.appendChild(block);
        scrollToBottom();
        return block;
    };

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = userInput.value.trim();
        if (!query) return;

        userInput.value = '';
        userInput.style.height = 'auto';
        userInput.disabled = true;
        sendBtn.disabled = true;

        appendMessage(query, true);
        const typingBlock = showTypingBlock();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            if (!response.ok) throw new Error('Stream error');

            typingBlock.remove();

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            
            const aiBlock = appendMessage('', false);
            const bodyPara = aiBlock.querySelector('.block-body');
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                fullText += chunk;
                bodyPara.innerHTML = `<p>${formatMarkdownSnippet(fullText)}</p>`;
                scrollToBottom();
            }
        } catch (error) {
            console.error('Chat error:', error);
            if (document.getElementById('typingBlock')) {
                document.getElementById('typingBlock').remove();
            }
            appendMessage('⚠️ Error processing request. Check Groq API configuration.', false);
        } finally {
            userInput.disabled = false;
            sendBtn.disabled = false;
            userInput.focus();
        }
    });

    clearBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/clear', { method: 'POST' });
            const firstBlock = chatHistory.firstElementChild;
            chatHistory.innerHTML = '';
            if (firstBlock) chatHistory.appendChild(firstBlock);
        } catch (error) {
            console.error('Failed to clear history:', error);
        }
    });

    // ==========================================
    // UTILITY HELPERS
    // ==========================================
    function formatMarkdownSnippet(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeForJs(str) {
        if (!str) return '';
        return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    }

    // INITIALIZATION
    loadDocuments();
    loadNotes();
});
