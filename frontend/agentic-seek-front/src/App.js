import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';
import { colors } from './colors';

function App() {
    // Input state
    const [query, setQuery] = useState('');
    const [inputPlaceholder, setInputPlaceholder] = useState('Type your query...');

    // Message state
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [messageError, setMessageError] = useState(null);

    // View state
    const [currentView, setCurrentView] = useState('blocks');
    const [responseData, setResponseData] = useState(null);

    // System state
    const [isOnline, setIsOnline] = useState(false);
    const [status, setStatus] = useState('Agents ready');

    // Screenshot state
    const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);
    const [screenshotError, setScreenshotError] = useState(null);

    // Refs
    const messagesEndRef = useRef(null);
    const lastProcessedTimestampRef = useRef(null);
    const processedMessageIdsRef = useRef(new Set()); // Track processed message IDs

    useEffect(() => {
        // Clear chat history when component mounts
        clearChat();

        // Initial checks when component mounts
        checkHealth();
        fetchScreenshot();

        // Set up polling interval
        const intervalId = setInterval(() => {
            checkHealth();
            fetchLatestAnswer();
            fetchScreenshot();
        }, 3000); // Increased to 3 seconds to reduce potential race conditions

        return () => clearInterval(intervalId);
    }, []); // Remove messages dependency to prevent re-polling on every message

    const checkHealth = async () => {
        try {
            await axios.get('http://0.0.0.0:8000/health');
            setIsOnline(true);
            console.log('System is online');
        } catch {
            setIsOnline(false);
            console.log('System is offline');
        }
    };

    const fetchScreenshot = async () => {
        try {
            setIsScreenshotLoading(true);
            setScreenshotError(null);

            const timestamp = new Date().getTime();
            const res = await axios.get(`http://0.0.0.0:8000/screenshots/updated_screen.png?timestamp=${timestamp}`, {
                responseType: 'blob'
            });

            // Check if we received a valid image
            if (res.data.type && res.data.type.startsWith('image/')) {
                console.log('Screenshot fetched successfully');
                const imageUrl = URL.createObjectURL(res.data);

                // Clean up previous screenshot URL to prevent memory leaks
                setResponseData((prev) => {
                    if (prev?.screenshot &&
                        prev.screenshot !== 'placeholder.png' &&
                        prev.screenshot.startsWith('blob:')) {
                        URL.revokeObjectURL(prev.screenshot);
                    }
                    return {
                        ...prev,
                        screenshot: imageUrl,
                        screenshotTimestamp: timestamp
                    };
                });
            } else {
                throw new Error('Invalid image data received');
            }
        } catch (err) {
            console.error('Error fetching screenshot:', err);
            setScreenshotError(err.message || 'Failed to load screenshot');

            // Only update to placeholder if we don't already have a screenshot
            setResponseData((prev) => ({
                ...prev,
                screenshot: prev?.screenshot || 'placeholder.png',
                screenshotTimestamp: new Date().getTime()
            }));
        } finally {
            setIsScreenshotLoading(false);
        }
    };

    const normalizeAnswer = (answer) => answer.trim().toLowerCase();

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };


    const fetchLatestAnswer = async () => {
        try {
            const res = await axios.get('http://0.0.0.0:8000/latest_answer');
            const data = res.data;

            // Debug blocks data
            console.log('Response data:', data);
            console.log('Blocks data:', data.blocks);
            if (data.blocks) {
                console.log('Blocks length:', Object.keys(data.blocks).length);
                console.log('Blocks values:', Object.values(data.blocks));
            }

            // Skip if no answer or empty answer
            if (!data.answer || data.answer.trim() === '') {
                return;
            }

            // Generate a consistent message ID based on content and timestamp
            const messageId = `msg-${data.timestamp}-${normalizeAnswer(data.answer).substring(0, 20).replace(/\s+/g, '-')}`;

            // Skip if we've already processed this message ID
            if (processedMessageIdsRef.current.has(messageId)) {
                return;
            }

            // Skip if we've already processed this timestamp
            if (lastProcessedTimestampRef.current === data.timestamp) {
                return;
            }

            // More robust deduplication check
            const answerExists = messages.some(msg => {
                // Check if this exact message (by timestamp) already exists
                if (msg.timestamp === data.timestamp) {
                    return true;
                }

                // Also check content similarity for messages without timestamps
                // or in case of timestamp issues
                if (msg.type === 'agent' &&
                    normalizeAnswer(msg.content) === normalizeAnswer(data.answer)) {
                    return true;
                }

                return false;
            });

            if (data.answer.length > 50) {
                console.log('Fetched latest answer:', data.answer.substring(0, 50) + '...');
            } else {
                console.log('Fetched latest answer:', data.answer);
            }

            if (!answerExists) {
                // Update the last processed timestamp and add to processed IDs
                lastProcessedTimestampRef.current = data.timestamp;
                processedMessageIdsRef.current.add(messageId);

                // Create the new message
                const newMessage = {
                    type: 'agent',
                    content: data.answer,
                    agentName: data.agent_name || 'Agent',
                    status: data.status,
                    timestamp: data.timestamp,
                    id: messageId,
                    receivedAt: new Date().toISOString()
                };

                // Update response data with blocks
                setResponseData(prevData => ({
                    ...prevData,
                    blocks: data.blocks || {}
                }));

                setMessages(prev => [...prev, newMessage]);
                setStatus(data.status || 'Processing');

                // Clear any previous message errors
                setMessageError(null);

                // Scroll to the bottom to show the new message
                scrollToBottom();
            }
        } catch (error) {
            console.error('Error fetching latest answer:', error);
            setMessageError('Failed to fetch the latest response');
        }
    };


    const handleSubmit = async (e) => {
        e.preventDefault();

        // Check if the system is online
        await checkHealth();

        // Validate input
        if (!query.trim()) {
            console.log('Empty query');
            return;
        }

        // Generate a unique ID for this user message
        const userMessageId = `user-msg-${Date.now()}-${normalizeAnswer(query).substring(0, 20).replace(/\s+/g, '-')}`;

        // Add user message to the chat
        const userMessage = {
            type: 'user',
            content: query,
            id: userMessageId,
            timestamp: Date.now(),
            sentAt: new Date().toISOString()
        };

        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);
        setMessageError(null);
        setScreenshotError(null);

        // Update UI to show loading state
        setInputPlaceholder('Waiting for response...');
        setQuery('');
        scrollToBottom();

        try {
            console.log('Sending query:', query);

            // Send the query to the backend
            const res = await axios.post('http://0.0.0.0:8000/query', {
                query,
                tts_enabled: false
            });

            console.log('Response received:', res.data);
            const data = res.data;

            // Debug blocks data
            console.log('Query response blocks:', data.blocks);
            if (data.blocks) {
                console.log('Query blocks length:', Object.keys(data.blocks).length);
                console.log('Query blocks values:', Object.values(data.blocks));
            }

            // Update the response data
            setResponseData(data);

            // Fetch the latest answer (this will add the agent's response to the chat)
            await fetchLatestAnswer();

            // Also fetch a fresh screenshot
            fetchScreenshot();

        } catch (err) {
            console.error('Error processing query:', err);
            setMessageError('Failed to process query. Please try again.');

            // Add an error message to the chat
            const errorMessageId = `error-${Date.now()}`;
            const errorMessage = {
                type: 'error',
                content: err.response?.data?.error || 'Error: Unable to get a response. Please try again.',
                id: errorMessageId,
                timestamp: Date.now(),
                sentAt: new Date().toISOString()
            };

            setMessages(prev => [...prev, errorMessage]);
            scrollToBottom();

        } finally {
            console.log('Query processing completed');
            setIsLoading(false);
            setInputPlaceholder('Type your query...');
        }
    };

    const handleGetScreenshot = async () => {
        try {
            setIsScreenshotLoading(true);
            setScreenshotError(null);
            console.log('Fetching screenshot on demand...');

            // Use the same timestamp approach as fetchScreenshot
            const timestamp = new Date().getTime();
            const res = await axios.get(`http://0.0.0.0:8000/screenshots/updated_screen.png?timestamp=${timestamp}`, {
                responseType: 'blob'
            });

            // Check if we received a valid image
            if (res.data.type && res.data.type.startsWith('image/')) {
                const imageUrl = URL.createObjectURL(res.data);

                // Clean up previous screenshot URL
                setResponseData((prev) => {
                    if (prev?.screenshot &&
                        prev.screenshot !== 'placeholder.png' &&
                        prev.screenshot.startsWith('blob:')) {
                        URL.revokeObjectURL(prev.screenshot);
                    }
                    return {
                        ...prev,
                        screenshot: imageUrl,
                        screenshotTimestamp: timestamp
                    };
                });

                // Switch to screenshot view
                setCurrentView('screenshot');
            } else {
                throw new Error('Invalid image data received');
            }
        } catch (err) {
            console.error('Error fetching screenshot on demand:', err);
            setScreenshotError('Browser not in use or screenshot unavailable');
            setMessageError('Browser not in use');
        } finally {
            setIsScreenshotLoading(false);
        }
    };

    // Function to clear chat history
    const clearChat = async () => {
        try {
            // Clear local state
            setMessages([]);

            // Reset all refs related to message tracking
            lastProcessedTimestampRef.current = null;
            processedMessageIdsRef.current = new Set();

            // Reset status and errors
            setStatus('Agents ready');
            setMessageError(null);

            // Also clear chat history on the backend
            if (isOnline) {
                const res = await axios.post('http://0.0.0.0:8000/clear_chat');
                console.log('Backend chat history cleared:', res.data);
            }

            console.log('Chat history cleared');
        } catch (err) {
            console.error('Error clearing chat history:', err);
            setMessageError('Failed to clear chat history on the server');
        }
    };

    // Debug function to test the editor view
    const addTestBlock = () => {
        const testBlock = {
            block: 'print("Hello, World!")',
            feedback: 'Execution success, code output:\nHello, World!',
            success: true,
            tool_type: 'python'
        };

        setResponseData(prevData => ({
            ...prevData,
            blocks: { '0': testBlock }
        }));

        console.log('Added test block to editor view');
    };

    return (
        <div className="app">
            <header className="header">
                <h1>AgenticSeek</h1>
            </header>
            <main className="main">
                <div className="app-sections">
                    <div className="task-section">
                        <h2>Task</h2>
                        <div className="task-details">
                            <p className="placeholder">No active task. Start a conversation to create a task.</p>
                        </div>
                    </div>

                    <div className="chat-section">
                        <div className="chat-header">
                            <h2>Chat Interface</h2>
                            <button
                                className="clear-chat-btn"
                                onClick={clearChat}
                                title="Clear chat history"
                                aria-label="Clear chat history"
                            >
                                Clear Chat
                            </button>
                        </div>
                        <div className="messages">
                            {messages.length === 0 ? (
                                <p className="placeholder">No messages yet. Type below to start!</p>
                            ) : (
                                messages.map((msg) => (
                                    <div
                                        key={msg.id || `fallback-${Math.random()}`} // Use unique ID as key
                                        className={`message ${
                                            msg.type === 'user'
                                                ? 'user-message'
                                                : msg.type === 'agent'
                                                ? 'agent-message'
                                                : 'error-message'
                                        }`}
                                    >
                                        {msg.type === 'agent' && (
                                            <span className="agent-name">{msg.agentName}</span>
                                        )}
                                        <p>{msg.content}</p>
                                    </div>
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                        {isOnline && <div className="loading-animation">{status}</div>}
                        {!isLoading && !isOnline && <p className="loading-animation">System offline. Deploy backend first.</p>}
                        <form onSubmit={handleSubmit} className="input-form">
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={inputPlaceholder}
                                disabled={isLoading}
                                aria-label="Chat input"
                            />
                            <button type="submit" disabled={isLoading}>
                                Send
                            </button>
                        </form>
                    </div>

                    <div className="computer-section">
                        <h2>Computer View</h2>
                        <div className="view-selector">
                            <button
                                className={currentView === 'blocks' ? 'active' : ''}
                                onClick={() => setCurrentView('blocks')}
                            >
                                Editor View
                            </button>
                            <button
                                className={currentView === 'screenshot' ? 'active' : ''}
                                onClick={responseData?.screenshot ? () => setCurrentView('screenshot') : handleGetScreenshot}
                            >
                                Browser View
                            </button>
                            <button
                                className="test-button"
                                onClick={addTestBlock}
                            >
                                Test Editor
                            </button>
                        </div>
                        <div className="content">
                            {messageError && <p className="error">{messageError}</p>}
                            {screenshotError && currentView === 'screenshot' && <p className="error">{screenshotError}</p>}
                            {currentView === 'blocks' ? (
                                <div className="blocks">
                                    {responseData && responseData.blocks && Object.values(responseData.blocks).length > 0 ? (
                                        Object.values(responseData.blocks).map((block, index) => (
                                            <div key={index} className="block">
                                                <p className="block-tool">Tool: {block.tool_type}</p>
                                                <pre>{block.block}</pre>
                                                <p className="block-feedback">Feedback: {block.feedback}</p>
                                                <p className="block-success">
                                                    Success: {block.success ? 'Yes' : 'No'}
                                                </p>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="block">
                                            <p className="block-tool">Tool: No tool in use</p>
                                            <pre>No file opened</pre>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="screenshot">
                                    {isScreenshotLoading ? (
                                        <div className="screenshot-loading">
                                            <p>Loading screenshot...</p>
                                        </div>
                                    ) : (
                                        <img
                                            src={responseData?.screenshot || 'placeholder.png'}
                                            alt="Screenshot"
                                            onError={(e) => {
                                                e.target.src = 'placeholder.png';
                                                console.error('Failed to load screenshot');
                                            }}
                                            key={responseData?.screenshotTimestamp || 'default'}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;
