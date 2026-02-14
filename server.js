const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected users and their data
const users = new Map();
const photos = [];

// Serve static files
app.use(express.static(__dirname));

// Serve the haggadah
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'haggadah-server.html'));
});

// WebSocket connection handler
wss.on('connection', (ws) => {
    const userId = uuidv4();
    console.log(`New connection: ${userId}`);

    // Send existing photos to new user
    ws.send(JSON.stringify({
        type: 'INIT_PHOTOS',
        photos: photos
    }));

    // Send existing users to new user
    const existingUsers = Array.from(users.values());
    ws.send(JSON.stringify({
        type: 'EXISTING_USERS',
        users: existingUsers
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'USER_JOIN':
                    // Add user to the map
                    const user = {
                        id: userId,
                        name: data.name,
                        avatar: data.avatar,
                        isAdmin: data.isAdmin,
                        page: data.page || 1
                    };
                    users.set(userId, user);

                    // Broadcast new user to all clients
                    broadcast({
                        type: 'USER_JOINED',
                        user: user
                    });

                    console.log(`User joined: ${data.name}`);
                    break;

                case 'PAGE_CHANGE':
                    // Update user's page
                    if (users.has(userId)) {
                        users.get(userId).page = data.page;
                        
                        // Broadcast page change
                        broadcast({
                            type: 'USER_PAGE_UPDATE',
                            userId: userId,
                            page: data.page
                        });
                    }
                    break;

                case 'PHOTO_UPLOAD':
                    // Store photo
                    const photo = {
                        id: uuidv4(),
                        url: data.url,
                        caption: data.caption,
                        timestamp: new Date().toISOString()
                    };
                    photos.push(photo);

                    // Keep only last 50 photos
                    if (photos.length > 50) {
                        photos.shift();
                    }

                    // Broadcast photo to all clients
                    broadcast({
                        type: 'NEW_PHOTO',
                        photo: photo
                    });

                    console.log(`New photo uploaded by ${data.caption}`);
                    break;

                case 'RESET_APP':
                    // Only admin can reset
                    const adminUser = users.get(userId);
                    if (adminUser && adminUser.isAdmin) {
                        // Clear all data
                        users.clear();
                        photos.length = 0;

                        // Broadcast reset to all clients
                        broadcast({
                            type: 'APP_RESET'
                        });

                        console.log('App reset by admin');
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        // Remove user from map
        const user = users.get(userId);
        if (user) {
            users.delete(userId);

            // Broadcast user left
            broadcast({
                type: 'USER_LEFT',
                userId: userId
            });

            console.log(`User left: ${user.name}`);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Broadcast message to all connected clients
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🫓 Vitkon Haggadah Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} in your browser`);
});
