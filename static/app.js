document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chatForm');
    const userInput = document.getElementById('userInput');
    const chatHistory = document.getElementById('chatHistory');
    const clearBtn = document.getElementById('clearBtn');
    const sendBtn = document.getElementById('sendBtn');

    // Auto-resize textarea
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.value.trim() === '') {
            this.style.height = 'auto';
        }
    });

    // Handle Enter key (Shift+Enter for new line)
    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (this.value.trim()) {
                chatForm.dispatchEvent(new Event('submit'));
            }
        }
    });

    // Scroll to bottom helper
    const scrollToBottom = () => {
        chatHistory.scrollTo({
            top: chatHistory.scrollHeight,
            behavior: 'smooth'
        });
    };

    // Add message to UI
    const appendMessage = (content, isUser = false) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        
        const avatarDiv = document.createElement('div');
        avatarDiv.className = `avatar ${isUser ? 'user-avatar' : 'ai-avatar'}`;
        avatarDiv.innerHTML = isUser ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Simple markdown parsing for bold and paragraphs
        const formattedContent = content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
            
        contentDiv.innerHTML = `<p>${formattedContent}</p>`;
        
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentDiv);
        chatHistory.appendChild(messageDiv);
        
        scrollToBottom();
        return contentDiv;
    };

    // Add typing indicator
    const showTypingIndicator = () => {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ai-message typing-msg';
        messageDiv.id = 'typingIndicator';
        
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'avatar ai-avatar';
        avatarDiv.innerHTML = '<i class="fa-solid fa-robot"></i>';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = `
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;
        
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentDiv);
        chatHistory.appendChild(messageDiv);
        
        scrollToBottom();
        return messageDiv;
    };

    // Handle form submission
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const query = userInput.value.trim();
        if (!query) return;

        // Reset input
        userInput.value = '';
        userInput.style.height = 'auto';
        userInput.focus();
        
        // Disable input while generating
        userInput.disabled = true;
        sendBtn.disabled = true;

        // Add user message
        appendMessage(query, true);
        
        // Show typing indicator
        const typingIndicator = showTypingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            if (!response.ok) throw new Error('Network response was not ok');

            // Remove typing indicator
            typingIndicator.remove();

            // Setup streaming read
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            
            // Create empty AI message container
            const aiContentContainer = appendMessage('', false);
            let aiText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                aiText += chunk;
                
                // Update UI with parsed markdown (very basic)
                const formatted = aiText
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br>');
                aiContentContainer.innerHTML = `<p>${formatted}</p>`;
                scrollToBottom();
            }
        } catch (error) {
            console.error('Error:', error);
            typingIndicator.remove();
            appendMessage("⚠️ Sorry, I encountered an error. Make sure your API key is configured.", false);
        } finally {
            // Re-enable input
            userInput.disabled = false;
            sendBtn.disabled = false;
            userInput.focus();
        }
    });

    // Handle Clear History
    clearBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/clear', { method: 'POST' });
            
            // Clear UI except for welcome message
            const welcomeMsg = chatHistory.firstElementChild;
            chatHistory.innerHTML = '';
            if (welcomeMsg) chatHistory.appendChild(welcomeMsg);
            
        } catch (error) {
            console.error('Failed to clear history:', error);
        }
    });
});
