const { ipcRenderer } = require('electron');

let permissions = {};

// Initialize when receiving data from main process
ipcRenderer.on('init-permission-wizard', (event, data) => {
    permissions = data.permissions || {};
    renderPermissions();
});

function renderPermissions() {
    const container = document.getElementById('permissions-list');
    container.innerHTML = '';
    
    const permissionTypes = [
        { key: 'accessibility', name: 'Accessibility Access', description: 'Required for monitoring user activity' },
        { key: 'screen_recording', name: 'Screen Recording', description: 'Required for taking screenshots' }
    ];
    
    permissionTypes.forEach(type => {
        const permission = permissions[type.key] || { granted: false, canRequest: true };
        
        const item = document.createElement('div');
        item.className = `permission-item ${permission.granted ? 'granted' : 'denied'}`;
        
        item.innerHTML = `
            <div class="permission-name">${type.name}</div>
            <div style="font-size: 12px; color: #666; margin-top: 5px;">${type.description}</div>
            <div class="permission-status">
                Status: <span class="${permission.granted ? 'status-granted' : 'status-denied'}">
                    ${permission.granted ? 'Granted' : 'Not Granted'}
                </span>
            </div>
        `;
        
        container.appendChild(item);
    });
}

// Handle setup permissions button
document.getElementById('setup-permissions').addEventListener('click', () => {
    showMessage('Opening System Preferences. Please grant the required permissions and restart the app.', 'success');
    
    // Request permissions through main process
    ipcRenderer.send('request-permissions');
    
    setTimeout(() => {
        window.close();
    }, 3000);
});

// Handle skip button
document.getElementById('skip-setup').addEventListener('click', () => {
    showMessage('Setup skipped. Some features may not work properly.', 'error');
    
    setTimeout(() => {
        window.close();
    }, 2000);
});

function showMessage(text, type) {
    const messageEl = document.getElementById('status-message');
    messageEl.textContent = text;
    messageEl.className = type;
    messageEl.style.display = 'block';
}