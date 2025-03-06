// Procore Low Voltage Inventory Management System
// This application integrates with Procore's API to track low voltage materials
// and equipment for construction projects

/**
 * Configuration and Setup
 */
const config = {
  apiBaseUrl: 'https://api.procore.com/rest/v1.0',
  appName: 'LV-Inventory-Tracker',
  version: '1.0.0'
};

/**
 * Class: Procore API Integration
 * Handles authentication and API requests to Procore
 */
class ProcoreAPI {
  constructor(clientId, clientSecret, redirectUri) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  // Initialize authentication
  async authenticate() {
    // Check if we have a valid token
    if (this.accessToken && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    // If we have a refresh token, use it
    if (this.refreshToken) {
      return await this.refreshAccessToken();
    }

    // Otherwise, redirect to authorization page
    const authUrl = `${config.apiBaseUrl}/oauth/authorize?client_id=${this.clientId}&response_type=code&redirect_uri=${encodeURIComponent(this.redirectUri)}`;
    window.location.href = authUrl;
  }

  // Handle OAuth callback and token exchange
  async handleCallback(authCode) {
    const response = await fetch(`${config.apiBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authCode,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri
      })
    });

    const data = await response.json();
    this.setTokens(data);
    return data.access_token;
  }

  // Refresh access token
  async refreshAccessToken() {
    const response = await fetch(`${config.apiBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret
      })
    });

    const data = await response.json();
    this.setTokens(data);
    return data.access_token;
  }

  // Store tokens and set expiry
  setTokens(data) {
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    
    // Set token expiry (default to 2 hours if not specified)
    const expiresIn = data.expires_in || 7200;
    this.tokenExpiry = new Date(new Date().getTime() + expiresIn * 1000);
    
    // Save tokens to localStorage for persistence
    localStorage.setItem('accessToken', this.accessToken);
    localStorage.setItem('refreshToken', this.refreshToken);
    localStorage.setItem('tokenExpiry', this.tokenExpiry.toString());
  }

  // Load tokens from localStorage
  loadTokens() {
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
    const expiryStr = localStorage.getItem('tokenExpiry');
    this.tokenExpiry = expiryStr ? new Date(expiryStr) : null;
  }

  // Make an authenticated API request
  async request(endpoint, method = 'GET', data = null) {
    const token = await this.authenticate();
    
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${config.apiBaseUrl}${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  }

  // Get projects
  async getProjects(companyId) {
    return this.request(`/companies/${companyId}/projects`);
  }

  // Get project details
  async getProject(projectId) {
    return this.request(`/projects/${projectId}`);
  }
}

/**
 * Class: Low Voltage Inventory Item
 * Represents a single inventory item with all relevant properties
 */
class LVInventoryItem {
  constructor(data = {}) {
    this.id = data.id || null;
    this.projectId = data.projectId || null;
    this.category = data.category || ''; // Cable, Connector, Equipment, etc.
    this.subCategory = data.subCategory || '';
    this.manufacturer = data.manufacturer || '';
    this.partNumber = data.partNumber || '';
    this.description = data.description || '';
    this.unitOfMeasure = data.unitOfMeasure || ''; // Feet, Each, Box, etc.
    this.quantityAvailable = data.quantityAvailable || 0;
    this.quantityAllocated = data.quantityAllocated || 0;
    this.reorderThreshold = data.reorderThreshold || 0;
    this.reorderQuantity = data.reorderQuantity || 0;
    this.location = data.location || ''; // Warehouse, Job Site, etc.
    this.cost = data.cost || 0;
    this.lastUpdated = data.lastUpdated || new Date();
    this.createdAt = data.createdAt || new Date();
    this.customFields = data.customFields || {};
  }

  // Calculate total quantity
  get totalQuantity() {
    return this.quantityAvailable + this.quantityAllocated;
  }

  // Check if reorder is needed
  get needsReorder() {
    return this.quantityAvailable <= this.reorderThreshold;
  }

  // Serialize for storage/API
  toJSON() {
    return {
      id: this.id,
      projectId: this.projectId,
      category: this.category,
      subCategory: this.subCategory,
      manufacturer: this.manufacturer,
      partNumber: this.partNumber,
      description: this.description,
      unitOfMeasure: this.unitOfMeasure,
      quantityAvailable: this.quantityAvailable,
      quantityAllocated: this.quantityAllocated,
      reorderThreshold: this.reorderThreshold,
      reorderQuantity: this.reorderQuantity,
      location: this.location,
      cost: this.cost,
      lastUpdated: this.lastUpdated,
      createdAt: this.createdAt,
      customFields: this.customFields
    };
  }
}

/**
 * Class: Inventory Manager
 * Manages the inventory items and operations
 */
class LVInventoryManager {
  constructor(procoreApi) {
    this.procoreApi = procoreApi;
    this.items = [];
    this.categories = [
      'Cable',
      'Connectors',
      'Devices',
      'Network Equipment',
      'Access Control',
      'Audio/Visual',
      'Security',
      'Telecommunications',
      'Fiber Optics',
      'Tools',
      'Mounting Hardware',
      'Conduit & Raceways',
      'Other'
    ];
    
    this.subCategories = {
      'Cable': ['Cat5e', 'Cat6', 'Cat6A', 'Fiber', 'Coaxial', 'Speaker', 'Security', 'Fire Alarm'],
      'Connectors': ['RJ45', 'F-Type', 'BNC', 'Fiber', 'Terminal Blocks'],
      'Devices': ['WAPs', 'Cameras', 'Card Readers', 'Speakers', 'Sensors'],
      // Additional subcategories can be added
    };
    
    this.unitOptions = ['Each', 'Box', 'Feet', 'Meter', 'Roll', 'Pair', 'Set', 'Lot'];
  }

  // Load inventory from API or local storage
  async loadInventory(projectId) {
    try {
      // Try to load from Procore custom fields or API endpoint
      const response = await this.procoreApi.request(`/projects/${projectId}/custom_fields/low_voltage_inventory`);
      this.items = response.map(item => new LVInventoryItem(item));
    } catch (error) {
      console.warn('Could not load inventory from API, checking local storage', error);
      
      // Fallback to local storage
      const storedItems = localStorage.getItem(`inventory_${projectId}`);
      if (storedItems) {
        this.items = JSON.parse(storedItems).map(item => new LVInventoryItem(item));
      }
    }
    
    return this.items;
  }

  // Save inventory to API and local storage
  async saveInventory(projectId) {
    try {
      // Save to Procore custom fields or API endpoint
      await this.procoreApi.request(
        `/projects/${projectId}/custom_fields/low_voltage_inventory`,
        'PUT',
        this.items.map(item => item.toJSON())
      );
    } catch (error) {
      console.warn('Could not save inventory to API, saving to local storage', error);
    }
    
    // Always save to local storage as backup
    localStorage.setItem(`inventory_${projectId}`, JSON.stringify(this.items.map(item => item.toJSON())));
    
    return true;
  }

  // Add a new inventory item
  addItem(itemData) {
    const newItem = new LVInventoryItem({
      ...itemData,
      id: Date.now().toString(),
      createdAt: new Date(),
      lastUpdated: new Date()
    });
    
    this.items.push(newItem);
    return newItem;
  }

  // Update an existing inventory item
  updateItem(itemId, updates) {
    const index = this.items.findIndex(item => item.id === itemId);
    if (index === -1) {
      throw new Error(`Item with ID ${itemId} not found`);
    }
    
    const updatedItem = new LVInventoryItem({
      ...this.items[index].toJSON(),
      ...updates,
      lastUpdated: new Date()
    });
    
    this.items[index] = updatedItem;
    return updatedItem;
  }

  // Delete an inventory item
  deleteItem(itemId) {
    const index = this.items.findIndex(item => item.id === itemId);
    if (index === -1) {
      throw new Error(`Item with ID ${itemId} not found`);
    }
    
    this.items.splice(index, 1);
    return true;
  }

  // Adjust quantity (add or remove)
  adjustQuantity(itemId, quantityChange, isAllocation = false) {
    const item = this.items.find(item => item.id === itemId);
    if (!item) {
      throw new Error(`Item with ID ${itemId} not found`);
    }
    
    if (isAllocation) {
      // Moving between available and allocated
      if (quantityChange > 0 && item.quantityAvailable < quantityChange) {
        throw new Error('Cannot allocate more than available quantity');
      }
      
      item.quantityAvailable -= quantityChange;
      item.quantityAllocated += quantityChange;
    } else {
      // Adding or removing from available inventory
      item.quantityAvailable += quantityChange;
      if (item.quantityAvailable < 0) {
        item.quantityAvailable = 0;
      }
    }
    
    item.lastUpdated = new Date();
    return item;
  }

  // Get items that need reordering
  getItemsNeedingReorder() {
    return this.items.filter(item => item.needsReorder);
  }

  // Search items by various criteria
  searchItems(criteria = {}) {
    return this.items.filter(item => {
      for (const [key, value] of Object.entries(criteria)) {
        if (!item[key] || !item[key].toString().toLowerCase().includes(value.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }

  // Generate inventory reports
  generateInventoryReport(filters = {}) {
    // Filter items based on provided filters
    let reportItems = this.items;
    
    if (Object.keys(filters).length > 0) {
      reportItems = this.searchItems(filters);
    }
    
    // Calculate summary statistics
    const totalItems = reportItems.length;
    const totalValue = reportItems.reduce((sum, item) => 
      sum + (item.cost * item.totalQuantity), 0);
    const lowStockItems = reportItems.filter(item => item.needsReorder).length;
    
    // Group by category
    const byCategory = {};
    reportItems.forEach(item => {
      byCategory[item.category] = byCategory[item.category] || { count: 0, value: 0 };
      byCategory[item.category].count++;
      byCategory[item.category].value += (item.cost * item.totalQuantity);
    });
    
    return {
      totalItems,
      totalValue,
      lowStockItems,
      byCategory,
      items: reportItems.map(item => item.toJSON())
    };
  }

  // Export inventory to CSV
  exportToCSV() {
    const headers = [
      'ID', 'Category', 'Sub-Category', 'Manufacturer', 'Part Number', 
      'Description', 'Unit', 'Quantity Available', 'Quantity Allocated',
      'Total Quantity', 'Reorder Threshold', 'Reorder Quantity',
      'Location', 'Cost', 'Total Value', 'Last Updated'
    ];
    
    const rows = this.items.map(item => [
      item.id,
      item.category,
      item.subCategory,
      item.manufacturer,
      item.partNumber,
      item.description,
      item.unitOfMeasure,
      item.quantityAvailable,
      item.quantityAllocated,
      item.totalQuantity,
      item.reorderThreshold,
      item.reorderQuantity,
      item.location,
      item.cost,
      (item.cost * item.totalQuantity).toFixed(2),
      new Date(item.lastUpdated).toLocaleDateString()
    ]);
    
    // Convert to CSV
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    return csvContent;
  }
}

/**
 * Class: User Interface Manager
 * Handles the UI components for the inventory management system
 */
class LVInventoryUI {
  constructor(inventoryManager, procoreApi) {
    this.inventoryManager = inventoryManager;
    this.procoreApi = procoreApi;
    this.currentProject = null;
  }

  // Initialize the UI
  async initialize() {
    // Load saved tokens
    this.procoreApi.loadTokens();
    
    // Check if we're on a callback URL
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    
    if (authCode) {
      try {
        await this.procoreApi.handleCallback(authCode);
        // Remove the code from URL
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (error) {
        console.error('Authentication error:', error);
        this.showError('Authentication failed. Please try again.');
        return;
      }
    }
    
    // Check if we're authenticated
    try {
      await this.procoreApi.authenticate();
      this.renderProjectSelector();
    } catch (error) {
      console.error('Authentication required:', error);
      this.renderLoginButton();
    }
  }

  // Render login button when not authenticated
  renderLoginButton() {
    const container = document.getElementById('app-container');
    container.innerHTML = `
      <div class="login-container">
        <h1>Low Voltage Inventory Tracker</h1>
        <p>Please login with your Procore account to continue</p>
        <button id="login-button" class="btn btn-primary">Login with Procore</button>
      </div>
    `;
    
    document.getElementById('login-button').addEventListener('click', () => {
      this.procoreApi.authenticate();
    });
  }

  // Render project selector after authentication
  async renderProjectSelector() {
    try {
      const container = document.getElementById('app-container');
      container.innerHTML = `
        <h1>Low Voltage Inventory Tracker</h1>
        <div class="loading">Loading projects...</div>
      `;
      
      // Get company ID from user profile or settings
      const userInfo = await this.procoreApi.request('/me');
      const companies = await this.procoreApi.request('/companies');
      
      if (companies.length === 0) {
        throw new Error('No companies found for this user');
      }
      
      // For simplicity, use the first company
      const companyId = companies[0].id;
      
      // Get projects for this company
      const projects = await this.procoreApi.getProjects(companyId);
      
      container.innerHTML = `
        <h1>Low Voltage Inventory Tracker</h1>
        <div class="project-selector">
          <label for="project-select">Select Project:</label>
          <select id="project-select" class="form-control">
            <option value="">-- Select a Project --</option>
            ${projects.map(project => `
              <option value="${project.id}">${project.name}</option>
            `).join('')}
          </select>
        </div>
        <div id="project-content"></div>
      `;
      
      document.getElementById('project-select').addEventListener('change', (e) => {
        const projectId = e.target.value;
        if (projectId) {
          this.loadProject(projectId);
        } else {
          document.getElementById('project-content').innerHTML = '';
        }
      });
      
    } catch (error) {
      console.error('Error loading projects:', error);
      this.showError('Failed to load projects. Please try again later.');
    }
  }

  // Load a specific project
  async loadProject(projectId) {
    try {
      const projectContent = document.getElementById('project-content');
      projectContent.innerHTML = '<div class="loading">Loading inventory...</div>';
      
      // Get project details
      this.currentProject = await this.procoreApi.getProject(projectId);
      
      // Load inventory for this project
      await this.inventoryManager.loadInventory(projectId);
      
      // Render the inventory interface
      this.renderInventoryInterface();
      
    } catch (error) {
      console.error('Error loading project:', error);
      this.showError('Failed to load project data. Please try again later.');
    }
  }

  // Render the main inventory interface
  renderInventoryInterface() {
    const projectContent = document.getElementById('project-content');
    
    projectContent.innerHTML = `
      <div class="inventory-container">
        <h2>${this.currentProject.name} - Low Voltage Inventory</h2>
        
        <div class="controls">
          <button id="add-item-btn" class="btn btn-success">Add New Item</button>
          <button id="export-csv-btn" class="btn btn-secondary">Export to CSV</button>
          <button id="generate-report-btn" class="btn btn-info">Generate Report</button>
          <div class="search-container">
            <input type="text" id="search-input" class="form-control" placeholder="Search inventory...">
          </div>
        </div>
        
        <div class="inventory-table-container">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Manufacturer</th>
                <th>Part Number</th>
                <th>Description</th>
                <th>Available</th>
                <th>Allocated</th>
                <th>Location</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="inventory-table-body">
              ${this.renderInventoryItems()}
            </tbody>
          </table>
        </div>
        
        <div id="item-modal" class="modal">
          <!-- Modal content will be dynamically inserted -->
        </div>
        
        <div id="report-modal" class="modal">
          <!-- Report content will be dynamically inserted -->
        </div>
      </div>
    `;
    
    // Add event listeners
    document.getElementById('add-item-btn').addEventListener('click', () => {
      this.showItemModal();
    });
    
    document.getElementById('export-csv-btn').addEventListener('click', () => {
      this.exportInventory();
    });
    
    document.getElementById('generate-report-btn').addEventListener('click', () => {
      this.showReportModal();
    });
    
    document.getElementById('search-input').addEventListener('input', (e) => {
      this.filterInventoryItems(e.target.value);
    });
    
    // Add event listeners for item actions (edit, delete, adjust)
    const tableBody = document.getElementById('inventory-table-body');
    tableBody.addEventListener('click', (e) => {
      const target = e.target;
      const itemId = target.closest('tr')?.dataset.itemId;
      
      if (!itemId) return;
      
      if (target.classList.contains('edit-btn')) {
        this.showItemModal(itemId);
      } else if (target.classList.contains('delete-btn')) {
        this.confirmDeleteItem(itemId);
      } else if (target.classList.contains('adjust-btn')) {
        this.showAdjustQuantityModal(itemId);
      }
    });
  }

  // Render inventory items as table rows
  renderInventoryItems() {
    if (this.inventoryManager.items.length === 0) {
      return `<tr><td colspan="8" class="empty-message">No inventory items found. Click "Add New Item" to get started.</td></tr>`;
    }
    
    return this.inventoryManager.items.map(item => `
      <tr data-item-id="${item.id}" class="${item.needsReorder ? 'low-stock' : ''}">
        <td>${item.category} ${item.subCategory ? `- ${item.subCategory}` : ''}</td>
        <td>${item.manufacturer}</td>
        <td>${item.partNumber}</td>
        <td>${item.description}</td>
        <td>${item.quantityAvailable} ${item.unitOfMeasure}</td>
        <td>${item.quantityAllocated} ${item.unitOfMeasure}</td>
        <td>${item.location}</td>
        <td class="actions">
          <button class="btn btn-sm btn-primary edit-btn">Edit</button>
          <button class="btn btn-sm btn-warning adjust-btn">Adjust</button>
          <button class="btn btn-sm btn-danger delete-btn">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  // Filter inventory items based on search input
  filterInventoryItems(searchTerm) {
    if (!searchTerm) {
      // If search is empty, show all items
      document.getElementById('inventory-table-body').innerHTML = this.renderInventoryItems();
      return;
    }
    
    const filteredItems = this.inventoryManager.items.filter(item => {
      const searchFields = [
        item.category,
        item.subCategory,
        item.manufacturer,
        item.partNumber,
        item.description,
        item.location
      ];
      
      return searchFields.some(field => 
        field.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
    
    // Store original items temporarily
    const originalItems = this.inventoryManager.items;
    
    // Replace with filtered items to render
    this.inventoryManager.items = filteredItems;
    document.getElementById('inventory-table-body').innerHTML = this.renderInventoryItems();
    
    // Restore original items
    this.inventoryManager.items = originalItems;
  }

  // Show modal for adding/editing items
  showItemModal(itemId = null) {
    const item = itemId 
      ? this.inventoryManager.items.find(item => item.id === itemId)
      : null;
    
    const modal = document.getElementById('item-modal');
    
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>${item ? 'Edit Item' : 'Add New Item'}</h3>
          <span class="close-modal">&times;</span>
        </div>
        <div class="modal-body">
          <form id="item-form">
            <div class="form-group">
              <label for="category">Category:</label>
              <select id="category" class="form-control" required>
                <option value="">-- Select Category --</option>
                ${this.inventoryManager.categories.map(cat => `
                  <option value="${cat}" ${item && item.category === cat ? 'selected' : ''}>${cat}</option>
                `).join('')}
              </select>
            </div>
            
            <div class="form-group">
              <label for="subCategory">Sub-Category:</label>
              <select id="subCategory" class="form-control">
                <option value="">-- Select Sub-Category --</option>
                ${item && this.inventoryManager.subCategories[item.category] 
                  ? this.inventoryManager.subCategories[item.category].map(subCat => `
                      <option value="${subCat}" ${item.subCategory === subCat ? 'selected' : ''}>${subCat}</option>
                    `).join('') 
                  : ''}
              </select>
            </div>
            
            <div class="form-group">
              <label for="manufacturer">Manufacturer:</label>
              <input type="text" id="manufacturer" class="form-control" value="${item ? item.manufacturer : ''}" required>
            </div>
            
            <div class="form-group">
              <label for="partNumber">Part Number:</label>
              <input type="text" id="partNumber" class="form-control" value="${item ? item.partNumber : ''}">
            </div>
            
            <div class="form-group">
              <label for="description">Description:</label>
              <textarea id="description" class="form-control" required>${item ? item.description : ''}</textarea>
            </div>
            
            <div class="form-row">
              <div class="form-group half">
                <label for="unitOfMeasure">Unit of Measure:</label>
                <select id="unitOfMeasure" class="form-control" required>
                  ${this.inventoryManager.unitOptions.map(unit => `
                    <option value="${unit}" ${item && item.unitOfMeasure === unit ? 'selected' : ''}>${unit}</option>
                  `).join('')}
                </select>
              </div>
              
              <div class="form-group half">
                <label for="cost">Cost per Unit:</label>
                <input type="number" id="cost" class="form-control" value="${item ? item.cost : '0.00'}" step="0.01" min="0">
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group half">
                <label for="quantityAvailable">Quantity Available:</label>
                <input type="number" id="quantityAvailable" class="form-control" value="${item ? item.quantityAvailable : '0'}" min="0" required>
              </div>
              
              <div class="form-group half">
                <label for="quantityAllocated">Quantity Allocated:</label>
                <input type="number" id="quantityAllocated" class="form-control" value="${item ? item.quantityAllocated : '0'}" min="0">
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group half">
                <label for="reorderThreshold">Reorder Threshold:</label>
                <input type="number" id="reorderThreshold" class="form-control" value="${item ? item.reorderThreshold : '0'}" min="0">
              </div>
              
              <div class="form-group half">
                <label for="reorderQuantity">Reorder Quantity:</label>
                <input type="number" id="reorderQuantity" class="form-control" value="${item ? item.reorderQuantity : '0'}" min="0">
              </div>
            </div>
            
            <div class="form-group">
              <label for="location">Storage Location:</label>
              <input type="text" id="location" class="form-control" value="${item ? item.location : ''}">
            </div>
            
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">${item ? 'Update Item' : 'Add Item'}</button>
              <button type="button" class="btn btn-secondary cancel-modal">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
    
    modal.style.display = 'block';
    
    // Add event listeners
    modal.querySelector('.close-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    modal.querySelector('.cancel-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    // Dynamic subcategory updates
    const categorySelect = document.getElementById('category');
    const subCategorySelect = document.getElementById('subCategory');
    
    categorySelect.addEventListener('change', () => {
      const selectedCategory = categorySelect.value;
      const subCategories = this.inventoryManager.subCategories[selectedCategory] || [];
      
      subCategorySelect.innerHTML = `
        <option value="">-- Select Sub-Category --</option>
        ${subCategories.map(subCat => `
          <option value="${subCat}">${subCat}</option>
        `).join('')}
      `;
    });
    
    // Form submission
    document.getElementById('item-form').addEventListener('submit', (e) => {
      e.preventDefault();
      
      const formData = {
        category: document.getElementById('category').value,
        subCategory: document.getElementById('subCategory').value,
        manufacturer: document.getElementById('manufacturer').value,
        partNumber: document.getElementById('partNumber').value,
        description: document.getElementById('description').value,
        unitOfMeasure: document.getElementById('unitOfMeasure').value,
        cost: parseFloat(document.getElementById('cost').value) || 0,
        quantityAvailable: parseInt(document.getElementById('quantityAvailable').value, 10) || 0,
        quantityAllocated: parseInt(document.getElementById('quantityAllocated').value, 10) || 0,
        reorderThreshold: parseInt(document.getElementById('reorderThreshold').value, 10) || 0,
        reorderQuantity: parseInt(document.getElementById('reorderQuantity').value, 10) || 0,
        location: document.getElementById('location').value,
        projectId: this.currentProject.id
      };
      
      try {
        if (item) {
          // Update existing item
          this.inventoryManager.updateItem(item.id, formData);
        } else {
          // Add new item
          this.inventoryManager.addItem(formData);
        }
        
        // Save to Procore/localStorage
        this.inventoryManager.saveInventory(this.currentProject.id);
        
        // Update the UI
        document.getElementById('inventory-table-body').innerHTML = this.renderInventoryItems();
        
        // Close the modal
        modal.style.display = 'none';
        
        // Show success message
        this.showMessage(`Item successfully ${item ? 'updated' : 'added'}.`);
      } catch (error) {
        console.error('Error saving item:', error);
        this.showError(`Failed to ${item ? 'update' : 'add'} item: ${error.message}`);
      }
    });
  }

  // Show modal for adjusting quantity
  showAdjustQuantityModal(itemId) {
    const item = this.inventoryManager.items.find(item => item.id === itemId);
    if (!item) return;
    
    const modal = document.getElementById('item-modal');
    
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Adjust Inventory Quantity</h3>
          <span class="close-modal">&times;</span>
        </div>
        <div class="modal-body">
          <h4>${item.manufacturer} - ${item.partNumber}</h4>
          <p>${item.description}</p>
          
          <div class="current-quantities">
            <div class="quantity-box">
              <span class="quantity-label">Available:</span>
              <span class="quantity-value">${item.quantityAvailable} ${item.unitOfMeasure}</span>
            </div>
            <div class="quantity-box">
              <span class="quantity-label">Allocated:</span>
              <span class="quantity-value">${item.quantityAllocated} ${item.unitOfMeasure}</span>
            </div>
            <div class="quantity-box">
              <span class="quantity-label">Total:</span>
              <span class="quantity-value">${item.totalQuantity} ${item.unitOfMeasure}</span>
            </div>
          </div>
          
          <form id="adjust-form">
            <div class="adjustment-type">
              <div class="form-group">
                <label>Adjustment Type:</label>
                <div class="radio-group">
                  <label>
                    <input type="radio" name="adjustmentType" value="add" checked> 
                    Add Inventory
                  </label>
                  <label>
                    <input type="radio" name="adjustmentType" value="remove"> 
                    Remove Inventory
                  </label>
                  <label>
                    <input type="radio" name="adjustmentType" value="allocate"> 
                    Allocate to Project
                  </label>
                  <label>
                    <input type="radio" name="adjustmentType" value="deallocate"> 
                    Return from Project
                  </label>
                </div>
              </div>
            </div>
            
            <div class="form-group">
              <label for="adjustQuantity">Quantity:</label>
              <input type="number" id="adjustQuantity" class="form-control" min="1" value="1" required>
            </div>
            
            <div class="form-group">
              <label for="adjustmentNotes">Notes:</label>
              <textarea id="adjustmentNotes" class="form-control" placeholder="Reason for adjustment, PO#, etc."></textarea>
            </div>
            
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Adjust Quantity</button>
              <button type="button" class="btn btn-secondary cancel-modal">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
    
    modal.style.display = 'block';
    
    // Add event listeners
    modal.querySelector('.close-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    modal.querySelector('.cancel-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    // Form submission
    document.getElementById('adjust-form').addEventListener('submit', (e) => {
      e.preventDefault();
      
      const adjustmentType = document.querySelector('input[name="adjustmentType"]:checked').value;
      const quantity = parseInt(document.getElementById('adjustQuantity').value, 10);
      const notes = document.getElementById('adjustmentNotes').value;
      
      try {
        switch (adjustmentType) {
          case 'add':
            this.inventoryManager.adjustQuantity(itemId, quantity, false);
            break;
          case 'remove':
            this.inventoryManager.adjustQuantity(itemId, -quantity, false);
            break;
          case 'allocate':
            this.inventoryManager.adjustQuantity(itemId, quantity, true);
            break;
          case 'deallocate':
            this.inventoryManager.adjustQuantity(itemId, -quantity, true);
            break;
        }
        
        // Save to Procore/localStorage
        this.inventoryManager.saveInventory(this.currentProject.id);
        
        // Update the UI
        document.getElementById('inventory-table-body').innerHTML = this.renderInventoryItems();
        
        // Close the modal
        modal.style.display = 'none';
        
        // Show success message
        this.showMessage('Quantity successfully adjusted.');
        
        // Log this transaction for audit trail (could be saved to Procore)
        console.log('Inventory adjustment:', {
          itemId,
          adjustmentType,
          quantity,
          notes,
          timestamp: new Date(),
          user: 'Current User', // Would come from Procore user context
          project: this.currentProject.id
        });
        
      } catch (error) {
        console.error('Error adjusting quantity:', error);
        this.showError(`Failed to adjust quantity: ${error.message}`);
      }
    });
  }

  // Confirm before deleting an item
  confirmDeleteItem(itemId) {
    const item = this.inventoryManager.items.find(item => item.id === itemId);
    if (!item) return;
    
    if (confirm(`Are you sure you want to delete "${item.manufacturer} ${item.partNumber}"? This cannot be undone.`)) {
      try {
        this.inventoryManager.deleteItem(itemId);
        
        // Save to Procore/localStorage
        this.inventoryManager.saveInventory(this.currentProject.id);
        
        // Update the UI
        document.getElementById('inventory-table-body').innerHTML = this.renderInventoryItems();
        
        // Show success message
        this.showMessage('Item successfully deleted.');
      } catch (error) {
        console.error('Error deleting item:', error);
        this.showError(`Failed to delete item: ${error.message}`);
      }
    }
  }

  // Export inventory to CSV file
  exportInventory() {
    const csvContent = this.inventoryManager.exportToCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${this.currentProject.name}_LV_Inventory_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
  }

  // Show report modal with inventory analysis
  showReportModal() {
    const report = this.inventoryManager.generateInventoryReport();
    
    const modal = document.getElementById('report-modal');
    
    modal.innerHTML = `
      <div class="modal-content report-modal">
        <div class="modal-header">
          <h3>Inventory Report</h3>
          <span class="close-modal">&times;</span>
        </div>
        <div class="modal-body">
          <div class="report-summary">
            <div class="summary-card">
              <div class="card-title">Total Items</div>
              <div class="card-value">${report.totalItems}</div>
            </div>
            <div class="summary-card">
              <div class="card-title">Total Value</div>
              <div class="card-value">${report.totalValue.toFixed(2)}</div>
            </div>
            <div class="summary-card">
              <div class="card-title">Low Stock Items</div>
              <div class="card-value">${report.lowStockItems}</div>
            </div>
          </div>
          
          <h4>Inventory by Category</h4>
          <div class="category-breakdown">
            <table class="report-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Item Count</th>
                  <th>Total Value</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(report.byCategory).map(([category, data]) => `
                  <tr>
                    <td>${category}</td>
                    <td>${data.count}</td>
                    <td>${data.value.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          <h4>Items Needing Reorder</h4>
          <div class="reorder-list">
            ${this.inventoryManager.getItemsNeedingReorder().length > 0 
              ? `<table class="report-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Available</th>
                      <th>Threshold</th>
                      <th>Reorder Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.inventoryManager.getItemsNeedingReorder().map(item => `
                      <tr>
                        <td>${item.manufacturer} - ${item.partNumber || item.description}</td>
                        <td>${item.quantityAvailable} ${item.unitOfMeasure}</td>
                        <td>${item.reorderThreshold} ${item.unitOfMeasure}</td>
                        <td>${item.reorderQuantity} ${item.unitOfMeasure}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>`
              : '<p>No items currently need reordering.</p>'
            }
          </div>
          
          <div class="form-actions">
            <button id="print-report-btn" class="btn btn-primary">Print Report</button>
            <button id="export-report-btn" class="btn btn-secondary">Export Report</button>
            <button class="btn btn-tertiary cancel-modal">Close</button>
          </div>
        </div>
      </div>
    `;
    
    modal.style.display = 'block';
    
    // Add event listeners
    modal.querySelector('.close-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    modal.querySelector('.cancel-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    document.getElementById('print-report-btn').addEventListener('click', () => {
      window.print();
    });
    
    document.getElementById('export-report-btn').addEventListener('click', () => {
      this.exportReport(report);
    });
  }

  // Export report as PDF or structured data
  exportReport(report) {
    // This could be implemented with a PDF library
    // For now, we'll just export the JSON data
    const reportData = JSON.stringify(report, null, 2);
    const blob = new Blob([reportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${this.currentProject.name}_LV_Inventory_Report_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    
    link.click();
    document.body.removeChild(link);
  }

  // Show temporary message
  showMessage(message) {
    const msgElement = document.createElement('div');
    msgElement.className = 'message success';
    msgElement.textContent = message;
    
    document.body.appendChild(msgElement);
    
    setTimeout(() => {
      msgElement.classList.add('fade-out');
      setTimeout(() => {
        document.body.removeChild(msgElement);
      }, 500);
    }, 3000);
  }

  // Show error message
  showError(message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'message error';
    errorElement.textContent = message;
    
    document.body.appendChild(errorElement);
    
    setTimeout(() => {
      errorElement.classList.add('fade-out');
      setTimeout(() => {
        document.body.removeChild(errorElement);
      }, 500);
    }, 5000);
  }
}

/**
 * Class: Procore Integration Sync Manager
 * Handles synchronization with Procore's data structures
 */
class ProcoreSyncManager {
  constructor(procoreApi, inventoryManager) {
    this.procoreApi = procoreApi;
    this.inventoryManager = inventoryManager;
  }

  // Sync inventory with purchase orders
  async syncWithPurchaseOrders(projectId) {
    try {
      // Get purchase orders from Procore
      const purchaseOrders = await this.procoreApi.request(`/projects/${projectId}/purchase_orders`);
      
      // Track which items we've updated
      const updatedItems = new Set();
      
      // Process each PO
      for (const po of purchaseOrders) {
        // Skip POs that aren't for low voltage material
        if (!this.isLowVoltagePO(po)) continue;
        
        // Get PO line items
        const lineItems = await this.procoreApi.request(`/projects/${projectId}/purchase_order_contracts/${po.id}/line_items`);
        
        for (const lineItem of lineItems) {
          // Try to match with existing inventory
          const matchedItem = this.findMatchingInventoryItem(lineItem);
          
          if (matchedItem) {
            // Update existing item
            if (po.status === 'Approved' || po.status === 'Closed') {
              // Only add to inventory if PO is approved or closed
              const quantityChange = lineItem.quantity - (lineItem.received_quantity || 0);
              
              if (quantityChange > 0) {
                this.inventoryManager.adjustQuantity(matchedItem.id, quantityChange, false);
                updatedItems.add(matchedItem.id);
              }
            }
          } else if (po.status === 'Approved' || po.status === 'Closed') {
            // Create new inventory item from PO line item
            const newItem = this.createInventoryItemFromPOLine(lineItem, projectId);
            this.inventoryManager.addItem(newItem);
            updatedItems.add(newItem.id);
          }
        }
      }
      
      // Save changes if any items were updated
      if (updatedItems.size > 0) {
        await this.inventoryManager.saveInventory(projectId);
        return updatedItems.size;
      }
      
      return 0;
    } catch (error) {
      console.error('Error syncing with purchase orders:', error);
      throw error;
    }
  }

  // Check if a PO is for low voltage material
  isLowVoltagePO(po) {
    // This would need customization based on how the company categorizes POs
    const lvKeywords = ['low voltage', 'lv', 'communications', 'data', 'telecom', 'network', 'cable'];
    
    // Check PO title, description, or cost code associations
    return lvKeywords.some(keyword => 
      po.title?.toLowerCase().includes(keyword) || 
      po.description?.toLowerCase().includes(keyword)
    );
  }

  // Find matching inventory item for a PO line item
  findMatchingInventoryItem(lineItem) {
    // Try to match based on part number or description
    return this.inventoryManager.items.find(item => 
      (lineItem.part_number && item.partNumber === lineItem.part_number) ||
      (item.description.toLowerCase().includes(lineItem.description.toLowerCase()))
    );
  }

  // Create inventory item from PO line item
  createInventoryItemFromPOLine(lineItem, projectId) {
    // Determine the most likely category based on description
    const category = this.determineCategoryFromDescription(lineItem.description);
    
    return {
      projectId,
      category,
      subCategory: '',
      manufacturer: lineItem.manufacturer || '',
      partNumber: lineItem.part_number || '',
      description: lineItem.description,
      unitOfMeasure: lineItem.unit || 'Each',
      quantityAvailable: lineItem.quantity,
      quantityAllocated: 0,
      reorderThreshold: Math.floor(lineItem.quantity * 0.2), // Default to 20% of initial quantity
      reorderQuantity: lineItem.quantity,
      location: 'From PO',
      cost: lineItem.unit_cost || 0
    };
  }

  // Determine category from description
  determineCategoryFromDescription(description) {
    const desc = description.toLowerCase();
    
    if (desc.includes('cable') || desc.includes('wire')) return 'Cable';
    if (desc.includes('connector') || desc.includes('terminal')) return 'Connectors';
    if (desc.includes('camera') || desc.includes('sensor')) return 'Devices';
    if (desc.includes('switch') || desc.includes('router') || desc.includes('access point')) return 'Network Equipment';
    if (desc.includes('card reader') || desc.includes('door')) return 'Access Control';
    if (desc.includes('speaker') || desc.includes('microphone') || desc.includes('projector')) return 'Audio/Visual';
    if (desc.includes('alarm') || desc.includes('motion') || desc.includes('security')) return 'Security';
    if (desc.includes('phone') || desc.includes('telecom')) return 'Telecommunications';
    if (desc.includes('fiber')) return 'Fiber Optics';
    if (desc.includes('tool')) return 'Tools';
    if (desc.includes('bracket') || desc.includes('mount')) return 'Mounting Hardware';
    if (desc.includes('conduit') || desc.includes('raceway') || desc.includes('tray')) return 'Conduit & Raceways';
    
    return 'Other';
  }

  // Sync with Procore RFIs for additional product information
  async syncWithRFIs(projectId) {
    try {
      // Get RFIs from Procore
      const rfis = await this.procoreApi.request(`/projects/${projectId}/rfis`);
      
      // Filter RFIs related to low voltage
      const lvRFIs = rfis.filter(rfi => 
        rfi.subject?.toLowerCase().includes('low voltage') ||
        rfi.subject?.toLowerCase().includes('communication') ||
        rfi.subject?.toLowerCase().includes('data') ||
        rfi.body?.toLowerCase().includes('low voltage') ||
        rfi.body?.toLowerCase().includes('communication') ||
        rfi.body?.toLowerCase().includes('data')
      );
      
      // Process relevant RFIs for inventory information
      for (const rfi of lvRFIs) {
        // Process responses for product information
        if (rfi.responses && rfi.responses.length > 0) {
          for (const response of rfi.responses) {
            // Extract product information from RFI responses
            this.extractProductInfoFromText(response.body);
          }
        }
      }
    } catch (error) {
      console.error('Error syncing with RFIs:', error);
      throw error;
    }
  }

  // Extract product information from text
  extractProductInfoFromText(text) {
    // This would need a more sophisticated implementation
    // Could use regex patterns to identify part numbers, manufacturers, etc.
    console.log('Extracted info from RFI text:', text.substring(0, 100) + '...');
  }
}

/**
 * Initialize the application
 */
function initApp() {
  // Get configuration from environment or config file
  const clientId = 'YOUR_PROCORE_CLIENT_ID';
  const clientSecret = 'YOUR_PROCORE_CLIENT_SECRET';
  const redirectUri = window.location.origin + '/callback';
  
  // Create instances
  const procoreApi = new ProcoreAPI(clientId, clientSecret, redirectUri);
  const inventoryManager = new LVInventoryManager(procoreApi);
  const ui = new LVInventoryUI(inventoryManager, procoreApi);
  
  // Initialize UI
  ui.initialize();
  
  // Create sync manager (could be used in scheduled syncs)
  const syncManager = new ProcoreSyncManager(procoreApi, inventoryManager);
  
  // Expose to window for debugging
  window.app = {
    procoreApi,
    inventoryManager,
    ui,
    syncManager
  };
}

// Add event listener for when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initApp);

/**
 * CSS Styles for the application
 */
const styles = `
  /* Main container */
  .app-container {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    color: #333;
  }

  h1, h2, h3, h4 {
    color: #2c3e50;
  }

  /* Login Screen */
  .login-container {
    text-align: center;
    margin-top: 100px;
  }

  /* Buttons */
  .btn {
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    border: none;
    transition: background-color 0.2s;
  }
  
  .btn-primary {
    background-color: #1976d2;
    color: white;
  }
  
  .btn-primary:hover {
    background-color: #1565c0;
  }
  
  .btn-secondary {
    background-color: #757575;
    color: white;
  }
  
  .btn-secondary:hover {
    background-color: #616161;
  }
  
  .btn-success {
    background-color: #2e7d32;
    color: white;
  }
  
  .btn-success:hover {
    background-color: #1b5e20;
  }
  
  .btn-warning {
    background-color: #ff9800;
    color: white;
  }
  
  .btn-warning:hover {
    background-color: #f57c00;
  }
  
  .btn-danger {
    background-color: #d32f2f;
    color: white;
  }
  
  .btn-danger:hover {
    background-color: #c62828;
  }
  
  .btn-info {
    background-color: #0288d1;
    color: white;
  }
  
  .btn-info:hover {
    background-color: #0277bd;
  }
  
  .btn-sm {
    padding: 4px 8px;
    font-size: 0.875rem;
  }

  /* Forms */
  .form-control {
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
    width: 100%;
    font-size: 1rem;
  }
  
  .form-group {
    margin-bottom: 15px;
  }
  
  .form-row {
    display: flex;
    margin-left: -10px;
    margin-right: -10px;
  }
  
  .form-group.half {
    width: 50%;
    padding: 0 10px;
  }
  
  .form-actions {
    margin-top: 20px;
    display: flex;
    gap: 10px;
  }

  /* Project selector */
  .project-selector {
    margin-bottom: 20px;
  }

  /* Inventory table */
  .inventory-table-container {
    margin-top: 20px;
    overflow-x: auto;
  }
  
  .inventory-table {
    width: 100%;
    border-collapse: collapse;
  }
  
  .inventory-table th, .inventory-table td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid #ddd;
  }
  
  .inventory-table th {
    background-color: #f5f5f5;
    font-weight: 600;
  }
  
  .inventory-table tr:hover {
    background-color: #f9f9f9;
  }
  
  .inventory-table tr.low-stock {
    background-color: #fff8e1;
  }
  
  .inventory-table .actions {
    display: flex;
    gap: 5px;
  }

  /* Controls section */
  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
    flex-wrap: wrap;
    gap: 10px;
  }
  
  .search-container {
    min-width: 300px;
  }

  /* Modal */
  .modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 1000;
    overflow: auto;
  }
  
  .modal-content {
    background-color: white;
    margin: 50px auto;
    padding: 0;
    width: 80%;
    max-width: 700px;
    border-radius: 8px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
    border-bottom: 1px solid #ddd;
  }
  
  .modal-body {
    padding: 20px;
  }
  
  .close-modal {
    font-size: 1.5rem;
    cursor: pointer;
    color: #757575;
  }
  
  .close-modal:hover {
    color: #333;
  }

  /* Adjustment form */
  .current-quantities {
    display: flex;
    margin: 15px 0;
    gap: 15px;
  }
  
  .quantity-box {
    background-color: #f5f5f5;
    padding: 10px;
    border-radius: 4px;
    flex: 1;
  }
  
  .quantity-label {
    font-weight: 600;
    display: block;
    margin-bottom: 5px;
    font-size: 0.875rem;
  }
  
  .quantity-value {
    font-size: 1.25rem;
  }
  
  .radio-group {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  
  .radio-group label {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  /* Report styles */
  .report-modal {
    max-width: 800px;
  }
  
  .report-summary {
    display: flex;
    gap: 20px;
    margin-bottom: 30px;
  }
  
  .summary-card {
    background-color: #f5f5f5;
    padding: 15px;
    border-radius: 8px;
    flex: 1;
    text-align: center;
  }
  
  .card-title {
    font-weight: 600;
    margin-bottom: 10px;
    color: #555;
  }
  
  .card-value {
    font-size: 2rem;
    font-weight: 700;
    color: #1976d2;
  }
  
  .report-table {
    width: 100%;
    border-collapse: collapse;
    margin: 15px 0 30px 0;
  }
  
  .report-table th, .report-table td {
    padding: 10px;
    text-align: left;
    border-bottom: 1px solid #ddd;
  }
  
  .report-table th {
    background-color: #f5f5f5;
    font-weight: 600;
  }

  /* Messages */
  .message {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 5px;
    color: white;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    z-index: 1500;
    transition: opacity 0.5s;
  }
  
  .message.success {
    background-color: #4caf50;
  }
  
  .message.error {
    background-color: #f44336;
  }
  
  .message.fade-out {
    opacity: 0;
  }

  /* Loading indicator */
  .loading {
    text-align: center;
    padding: 40px;
    font-style: italic;
    color: #757575;
  }

  /* Empty state */
  .empty-message {
    text-align: center;
    padding: 30px;
    font-style: italic;
    color: #757575;
  }

  /* Print styles */
  @media print {
    body * {
      visibility: hidden;
    }
    
    .modal-content, .modal-content * {
      visibility: visible;
    }
    
    .modal-content {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      margin: 0;
      padding: 15px;
      box-shadow: none;
    }
    
    .form-actions, .close-modal {
      display: none;
    }
  }
`;

// Add styles to the document
function addStyles() {
  const styleElement = document.createElement('style');
  styleElement.textContent = styles;
  document.head.appendChild(styleElement);
}

// Call this function when DOM is loaded
document.addEventListener('DOMContentLoaded', addStyles);
