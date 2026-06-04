/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * @author didierfred@gmail.com
 * Refactored with Groups support
 */

// ===========================
// STATE
// ===========================

var started = 'off';
var show_comments = true;
var debug_mode = false;
var config = null;
let currentFilter = 'all'; // 'all', 'global', or group id
let editingGroupId = null;
let ruleIdCounter = 1;
let groupIdCounter = 1;
let autoSaveTimer = null;
let currentTheme = 'light';

// ===========================
// INITIALIZATION
// ===========================

window.onload = function () {
    I18n.init().then(() => initConfigurationPage());
};

function initConfigurationPage() {
    started = 'off';
    loadFromBrowserStorage(['config', 'started', 'theme'], function (result) {
        if (result.started) started = result.started;
        
        // Load theme
        if (result.theme) {
            currentTheme = result.theme;
            applyTheme(currentTheme);
        }

        if (result.config === undefined) {
            config = getDefaultConfig();
        } else {
            config = JSON.parse(result.config);
            config = migrateConfig(config);
            if (useManifestV3) config = removeCookiesActionFromConfig(config);
        }

        // Init counters — use max existing id number to avoid duplicates after deletions
        groupIdCounter = config.groups && config.groups.length > 0
            ? Math.max(...config.groups.map(g => parseInt(g.id.replace('group_', '')) || 0)) + 1
            : 1;
        ruleIdCounter = config.headers.length > 0
            ? Math.max(...config.headers.map(h => parseInt(h.id.replace('rule_', '')) || 0)) + 1
            : 1;

        // Load settings
        if (config.debug_mode) {
            document.getElementById('debug_mode').checked = true;
            debug_mode = true;
        }

        if (typeof config.show_comments === 'undefined') {
            document.getElementById('show_comments').checked = true;
            show_comments = true;
        } else {
            document.getElementById('show_comments').checked = config.show_comments;
            show_comments = config.show_comments;
        }

        // Render UI
        renderGroupsList();
        renderRules();
        updateBadges();
        updateStartStopIcon();

        // Event listeners
        setupEventListeners();
    });
}

function getDefaultConfig() {
    return {
        format_version: '2.0',
        groups: [],
        headers: [
            {
                id: 'rule_' + ruleIdCounter++,
                group_id: null,
                url_contains: '',
                action: 'add',
                header_name: 'test-header-name',
                header_value: 'test-header-value',
                comment: 'test',
                apply_on: 'req',
                status: 'on'
            }
        ],
        debug_mode: false,
        show_comments: true
    };
}

// ===========================
// MIGRATION
// ===========================

function migrateConfig(config) {
    if (config.format_version === '2.0') {
        // Ensure default_url_filter and users_url_filter exist on all groups
        if (config.groups) {
            config.groups.forEach(group => {
                if (!group.hasOwnProperty('default_url_filter')) {
                    group.default_url_filter = '';
                }
                if (!group.hasOwnProperty('users_url_filter')) {
                    group.users_url_filter = [];
                }
            });
        }
        return config;
    }

    let migrated = {
        format_version: '2.0',
        groups: [],
        headers: [],
        debug_mode: config.debug_mode || false,
        show_comments: config.show_comments !== undefined ? config.show_comments : true
    };

    // Create a default group from target_page if it exists
    if (config.target_page && config.target_page.trim() !== '' && config.target_page.trim() !== '*') {
        let urls = config.target_page.split(';').map(u => u.trim()).filter(u => u !== '');
        if (urls.length > 0) {
            migrated.groups.push({
                id: 'group_' + groupIdCounter++,
                name: 'Default',
                urls: urls,
                status: 'on',
                color: '#4CAF50'
            });
        }
    }

    // Migrate headers
    let defaultGroupId = migrated.groups.length > 0 ? migrated.groups[0].id : null;
    for (let header of config.headers) {
        let migratedHeader = {
            id: 'rule_' + ruleIdCounter++,
            group_id: header.url_contains ? defaultGroupId : null,
            url_contains: header.url_contains || '',
            action: header.action,
            header_name: header.header_name,
            header_value: header.header_value,
            comment: header.comment || '',
            apply_on: header.apply_on || 'req',
            status: header.status || 'on'
        };
        migrated.headers.push(migratedHeader);
    }

    return migrated;
}

function removeCookiesActionFromConfig(config) {
    config.headers = config.headers.filter(h =>
        h.action !== 'cookie_add_or_modify' && h.action !== 'cookie_delete'
    );
    return config;
}

// ===========================
// STORAGE
// ===========================

// ===========================
// EVENT LISTENERS
// ===========================

function setupEventListeners() {
    // Header buttons
    document.getElementById('start_stop_btn').addEventListener('click', startModify);
    document.getElementById('export_button').addEventListener('click', exportData);
    document.getElementById('import_button').addEventListener('click', importData);
    document.getElementById('append_button').addEventListener('click', appendData);
    document.getElementById('parameters_button').addEventListener('click', showParametersScreen);
    document.getElementById('exit_parameters_screen_button').addEventListener('click', hideParametersScreen);
    document.getElementById('save_button').addEventListener('click', saveData);

    // Parameters
    document.getElementById('debug_mode').addEventListener('click', function () {
        debug_mode = this.checked;
    });
    document.getElementById('show_comments').addEventListener('click', function () {
        show_comments = this.checked;
        renderRules();
    });

    // Group management
    document.getElementById('add_group_button').addEventListener('click', openNewGroupEditor);
    document.getElementById('close_group_editor').addEventListener('click', closeGroupEditor);
    document.getElementById('save_group_button').addEventListener('click', saveGroup);
    document.getElementById('delete_group_button').addEventListener('click', deleteGroup);
    document.getElementById('add_url_to_group').addEventListener('click', addUrlInputToEditor);
    document.getElementById('add_inline_user_filter').addEventListener('click', addInlineUserFilter);

    // Theme toggle
    document.getElementById('theme_toggle').addEventListener('change', toggleTheme);

    // Language selector
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            I18n.setLang(this.dataset.lang);
        });
    });

    // Filters
    document.getElementById('filter_all').addEventListener('click', function () {
        setFilter('all');
    });
    document.getElementById('filter_global').addEventListener('click', function () {
        setFilter('global');
    });

    // Add rule
    document.getElementById('add_rule_button').addEventListener('click', addNewRule);

    // Global rules drop zone (to move rules from group to global)
    setupGlobalRulesDropZone();

    // Search
    document.getElementById('search_rules').addEventListener('input', function () {
        renderRules();
    });

    // Collapse/Expand sections
    setupSectionToggle('global_rules_drop_zone', 'global_content', 'global_toggle');
}

function setupSectionToggle(headerId, contentId, toggleId) {
    let header = document.getElementById(headerId);
    let content = document.getElementById(contentId);
    let toggle = document.getElementById(toggleId);
    
    if (!header || !content || !toggle) return;
    
    header.addEventListener('click', function (e) {
        // Don't toggle if clicking on buttons inside the header
        if (e.target.closest('.section-actions') || e.target.closest('.btn')) return;
        
        let isCollapsed = content.classList.contains('collapsed');
        if (isCollapsed) {
            content.classList.remove('collapsed');
            toggle.classList.remove('collapsed');
        } else {
            content.classList.add('collapsed');
            toggle.classList.add('collapsed');
        }
    });
}

// ===========================
// FILTERS
// ===========================

function setFilter(filter) {
    currentFilter = filter;

    // Update filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (filter === 'all') {
        document.getElementById('filter_all').classList.add('active');
    } else if (filter === 'global') {
        document.getElementById('filter_global').classList.add('active');
    } else {
        let groupBtn = document.querySelector(`.group-item[data-group-id="${filter}"]`);
        if (groupBtn) groupBtn.classList.add('active');
    }

    // Update group items
    document.querySelectorAll('.group-item').forEach(item => {
        item.classList.toggle('active', item.dataset.groupId === filter);
    });

    renderRules();
}

// ===========================
// GROUPS RENDERING
// ===========================

function renderGroupsList() {
    let container = document.getElementById('groups_list');
    container.innerHTML = '';

    if (!config.groups) return;

    config.groups.forEach((group, index) => {
        let count = config.headers.filter(h => h.group_id === group.id).length;
        let div = document.createElement('div');
        div.className = 'group-item' + (currentFilter === group.id ? ' active' : '') + (group.status === 'off' ? ' group-status-off' : '');
        div.dataset.groupId = group.id;
        div.setAttribute('draggable', 'true');

        div.innerHTML = `
            <span class="group-color-dot" style="background:${group.color}"></span>
            <span class="group-item-name" title="${escapeHtml(group.urls.join('\n'))}">${escapeHtml(group.name)}</span>
            <span class="group-item-count">${count}</span>
            <div class="group-item-actions">
                <button class="group-action-btn edit-group-btn" title="Edit group">
                    <span class="glyphicon glyphicon-pencil"></span>
                </button>
            </div>
        `;

        // Drag events for reordering groups
        div.addEventListener('dragstart', function (e) {
            draggedGroupId = group.id;
            draggedRuleId = null;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', group.id);
        });
        div.addEventListener('dragend', function () {
            this.classList.remove('dragging');
            draggedGroupId = null;
            document.querySelectorAll('.group-item.drop-target').forEach(el => el.classList.remove('drop-target'));
        });

        // Drop target for reordering groups
        div.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggedGroupId && draggedGroupId !== group.id) {
                this.classList.add('drop-target');
            }
        });
        div.addEventListener('dragleave', function () {
            this.classList.remove('drop-target');
        });
        div.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove('drop-target');

            // Reorder group
            if (draggedGroupId && draggedGroupId !== group.id) {
                let fromIdx = config.groups.findIndex(g => g.id === draggedGroupId);
                let toIdx = config.groups.findIndex(g => g.id === group.id);
                if (fromIdx !== -1 && toIdx !== -1) {
                    let [moved] = config.groups.splice(fromIdx, 1);
                    config.groups.splice(toIdx, 0, moved);
                    draggedGroupId = null;
                    renderGroupsList();
                    scheduleAutoSave();
                }
                return;
            }

            // Move rule to group
            if (draggedRuleId) {
                let rule = config.headers.find(h => h.id === draggedRuleId);
                if (rule) {
                    rule.group_id = group.id;
                    draggedRuleId = null;
                    draggedRow = null;
                    renderGroupsList();
                    renderRules();
                    updateBadges();
                    scheduleAutoSave();
                }
            }
        });

        div.addEventListener('click', function (e) {
            if (e.target.closest('.edit-group-btn')) {
                openEditGroupEditor(group.id);
            } else {
                setFilter(group.id);
            }
        });

        container.appendChild(div);
    });
}

function updateBadges() {
    document.getElementById('badge_all').textContent = config.headers.length;
    document.getElementById('badge_global').textContent = config.headers.filter(h => !h.group_id).length;
}

// ===========================
// THEME
// ===========================

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(currentTheme);
    storeInBrowserStorage({ theme: currentTheme });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    let toggle = document.getElementById('theme_toggle');
    if (toggle) {
        toggle.checked = theme === 'dark';
    }
}

// ===========================
// GROUP EDITOR
// ===========================

function openNewGroupEditor() {
    editingGroupId = null;
    document.getElementById('group_editor_title').textContent = 'New Group';
    document.getElementById('group_name_input').value = '';
    document.getElementById('group_status_toggle').checked = true;
    document.getElementById('group_default_url_filter').value = '';
    document.getElementById('group_color_picker').value = '#4CAF50';
    document.getElementById('delete_group_button').hidden = true;

    // Reset color picker
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector('.color-btn[data-color="#4CAF50"]').classList.add('selected');

    // Clear URLs
    let urlsEditor = document.getElementById('urls_editor');
    urlsEditor.innerHTML = '';
    addUrlInputToEditor('');

    // Clear Others URL Filters
    let usersUrlFiltersEditor = document.getElementById('users_url_filters_editor');
    usersUrlFiltersEditor.innerHTML = '';
    addUserUrlFilterInput('');

    document.getElementById('group_editor').hidden = false;
    document.getElementById('rules_content').hidden = true;
    document.getElementById('group_name_input').focus();
}

function openEditGroupEditor(groupId) {
    let group = config.groups.find(g => g.id === groupId);
    if (!group) return;

    editingGroupId = groupId;
    document.getElementById('group_editor_title').textContent = 'Edit Group';
    document.getElementById('group_name_input').value = group.name;
    document.getElementById('group_status_toggle').checked = group.status === 'on';
    document.getElementById('group_default_url_filter').value = group.default_url_filter || '';
    document.getElementById('delete_group_button').hidden = false;

    // Set color
    document.getElementById('group_color_picker').value = group.color || '#4CAF50';
    document.querySelectorAll('.color-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.color === group.color);
    });

    // Set URLs
    let urlsEditor = document.getElementById('urls_editor');
    urlsEditor.innerHTML = '';
    group.urls.forEach(url => addUrlInputToEditor(url));

    // Set Others URL Filters
    let usersUrlFiltersEditor = document.getElementById('users_url_filters_editor');
    usersUrlFiltersEditor.innerHTML = '';
    if (group.users_url_filter && group.users_url_filter.length > 0) {
        group.users_url_filter.forEach(filter => addUserUrlFilterInput(filter));
    } else {
        addUserUrlFilterInput('');
    }

    document.getElementById('group_editor').hidden = false;
    document.getElementById('rules_content').hidden = true;
    document.getElementById('group_name_input').focus();
}

function closeGroupEditor() {
    document.getElementById('group_editor').hidden = true;
    document.getElementById('rules_content').hidden = false;
    editingGroupId = null;
}

function addUrlInputToEditor(url) {
    if (typeof url !== 'string') url = '';
    let urlsEditor = document.getElementById('urls_editor');
    let row = document.createElement('div');
    row.className = 'url-input-row';
    row.innerHTML = `
        <input type="text" class="form_control url-pattern-input" value="${escapeHtml(url)}" placeholder="https://example.com/*" title="Valid: scheme://host/path (e.g. https://example.com/*, *://*.domain.com/*)">
        <button type="button" class="url-remove-btn" title="Remove">
            <span class="glyphicon glyphicon-remove"></span>
        </button>
    `;
    let input = row.querySelector('input');
    
    // Validate on input
    input.addEventListener('input', function() {
        validateUrlPatternInput(this);
    });
    
    // Validate on blur
    input.addEventListener('blur', function() {
        validateUrlPatternInput(this);
    });
    
    row.querySelector('.url-remove-btn').addEventListener('click', function () {
        row.remove();
    });
    urlsEditor.appendChild(row);
    
    // Validate initial value
    if (url) validateUrlPatternInput(input);
}

function addUserUrlFilterInput(value) {
    if (typeof value !== 'string') value = '';
    let editor = document.getElementById('users_url_filters_editor');
    let row = document.createElement('div');
    row.className = 'url-input-row';
    row.innerHTML = `
        <input type="text" class="form_control user-url-filter-input" value="${escapeHtml(value)}" placeholder="e.g. /api/v1, /api/v2">
        <button type="button" class="url-remove-btn" title="Remove">
            <span class="glyphicon glyphicon-remove"></span>
        </button>
    `;
    row.querySelector('.url-remove-btn').addEventListener('click', function () {
        row.remove();
    });
    editor.appendChild(row);
}

function saveGroup() {
    let name = document.getElementById('group_name_input').value.trim();
    if (!name) {
        alert('Please enter a group name.');
        return;
    }

    let selectedColor = document.querySelector('.color-btn.selected');
    let color = document.getElementById('group_color_picker').value || (selectedColor ? selectedColor.dataset.color : '#4CAF50');
    let status = document.getElementById('group_status_toggle').checked ? 'on' : 'off';
    let defaultUrlFilter = document.getElementById('group_default_url_filter').value.trim();

    // Collect and validate URLs
    let urlInputs = document.querySelectorAll('.url-pattern-input');
    let urls = [];
    let hasInvalidUrl = false;
    urlInputs.forEach(input => {
        let val = input.value.trim();
        if (val) {
            if (isValidUrlPattern(val)) {
                urls.push(val);
                input.style.borderColor = '';
                input.style.color = '';
            } else {
                hasInvalidUrl = true;
                input.style.borderColor = '#F44336';
                input.style.color = '#F44336';
            }
        }
    });

    if (hasInvalidUrl) {
        alert('Some URL patterns are invalid. Please fix them before saving.\n\nValid format: scheme://host/path\nExamples:\n  https://example.com/*\n  http://localhost:3000/*\n  *://*.example.com/*');
        return;
    }

    if (urls.length === 0) {
        urls.push('*');
    }

    // Collect Others URL Filters
    let userUrlFilterInputs = document.querySelectorAll('.user-url-filter-input');
    let usersUrlFilter = [];
    userUrlFilterInputs.forEach(input => {
        let val = input.value.trim();
        if (val) usersUrlFilter.push(val);
    });

    if (editingGroupId) {
        // Update existing group
        let group = config.groups.find(g => g.id === editingGroupId);
        if (group) {
            group.name = name;
            group.color = color;
            group.urls = urls;
            group.status = status;
            group.default_url_filter = defaultUrlFilter;
            group.users_url_filter = usersUrlFilter;
            
            // Apply default_url_filter to all rules in this group
            if (defaultUrlFilter) {
                config.headers.forEach(h => {
                    if (h.group_id === editingGroupId && !h.url_contains) {
                        h.url_contains = defaultUrlFilter;
                    }
                });
            }
        }
    } else {
        // Create new group
        let newGroup = {
            id: 'group_' + groupIdCounter++,
            name: name,
            urls: urls,
            status: status,
            color: color,
            default_url_filter: defaultUrlFilter,
            users_url_filter: usersUrlFilter
        };
        config.groups.push(newGroup);
    }

    closeGroupEditor();
    renderGroupsList();
    renderRules();
    updateBadges();
}

function deleteGroup() {
    if (!editingGroupId) return;
    let group = config.groups.find(g => g.id === editingGroupId);
    let groupName = group ? group.name : '';
    if (!confirm(`Delete group "${groupName}"?\nRules assigned to it will become global.`)) return;

    // Move rules to global
    config.headers.forEach(h => {
        if (h.group_id === editingGroupId) h.group_id = null;
    });

    config.groups = config.groups.filter(g => g.id !== editingGroupId);
    if (currentFilter === editingGroupId) currentFilter = 'all';

    closeGroupEditor();
    renderGroupsList();
    renderRules();
    updateBadges();
}

// ===========================
// GLOBAL RULES DROP ZONE
// ===========================

function setupGlobalRulesDropZone() {
    let dropZone = document.getElementById('global_rules_drop_zone');
    dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drag-hover');
    });
    dropZone.addEventListener('dragleave', function () {
        this.classList.remove('drag-hover');
    });
    dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('drag-hover');
        if (draggedRuleId) {
            let rule = config.headers.find(h => h.id === draggedRuleId);
            if (rule && rule.group_id) {
                rule.group_id = null;
                draggedRuleId = null;
                draggedRow = null;
                renderGroupsList();
                renderRules();
                updateBadges();
                scheduleAutoSave();
            }
        }
    });
}

// ===========================
// GROUP RULES DROP ZONE
// ===========================

function setupGroupRulesDropZone(groupId) {
    let dropZone = document.getElementById('group_rules_drop_zone');
    // Clone to remove old listeners
    let newDropZone = dropZone.cloneNode(true);
    dropZone.parentNode.replaceChild(newDropZone, dropZone);

    newDropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drag-hover');
    });
    newDropZone.addEventListener('dragleave', function () {
        this.classList.remove('drag-hover');
    });
    newDropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('drag-hover');
        if (draggedRuleId) {
            let rule = config.headers.find(h => h.id === draggedRuleId);
            if (rule) {
                rule.group_id = groupId;
                draggedRuleId = null;
                draggedRow = null;
                renderGroupsList();
                renderRules();
                updateBadges();
                scheduleAutoSave();
            }
        }
    });

    // Re-attach the toggle and edit button listeners
    document.getElementById('toggle_group_rules_btn').addEventListener('click', toggleGroupRules);
    document.getElementById('edit_group_btn').addEventListener('click', function() {
        if (currentFilter !== 'all' && currentFilter !== 'global') {
            openEditGroupEditor(currentFilter);
        }
    });

    // Setup collapse toggle for group section
    setupSectionToggle('group_rules_drop_zone', 'group_content', 'group_toggle');
}

// ===========================
// GROUP FILTERS INLINE
// ===========================

function loadGroupFiltersInline(group) {
    // Load default URL filter
    let defaultInput = document.getElementById('inline_default_url_filter');
    defaultInput.value = group.default_url_filter || '';
    
    // Remove old event listener
    let newDefaultInput = defaultInput.cloneNode(true);
    defaultInput.parentNode.replaceChild(newDefaultInput, defaultInput);
    
    // Add new event listener
    newDefaultInput.addEventListener('change', function() {
        group.default_url_filter = this.value.trim();
        scheduleAutoSave();
    });

    // Load users URL filters
    let filtersContainer = document.getElementById('inline_users_url_filters');
    filtersContainer.innerHTML = '';
    
    let filters = group.users_url_filter || [];
    filters.forEach((filter, index) => {
        addInlineFilterChip(group, filtersContainer, filter, index);
    });
}

function addInlineFilterChip(group, container, value, index) {
    let chip = document.createElement('div');
    chip.className = 'inline-filter-chip';
    chip.innerHTML = `
        <input type="text" value="${escapeHtml(value)}" placeholder="filter" data-index="${index}">
        <span class="chip-remove" title="Remove">&times;</span>
    `;
    
    let input = chip.querySelector('input');
    input.addEventListener('change', function() {
        let idx = parseInt(this.dataset.index);
        if (group.users_url_filter && group.users_url_filter[idx] !== undefined) {
            group.users_url_filter[idx] = this.value.trim();
            // Re-render rules to update dropdowns
            renderRules();
            scheduleAutoSave();
        }
    });
    
    chip.querySelector('.chip-remove').addEventListener('click', function() {
        let idx = parseInt(input.dataset.index);
        if (group.users_url_filter) {
            group.users_url_filter.splice(idx, 1);
            loadGroupFiltersInline(group);
            renderRules();
            scheduleAutoSave();
        }
    });
    
    container.appendChild(chip);
}

function addInlineUserFilter() {
    let group = config.groups.find(g => g.id === currentFilter);
    if (!group) return;
    
    if (!group.users_url_filter) {
        group.users_url_filter = [];
    }
    group.users_url_filter.push('');
    loadGroupFiltersInline(group);
}

function toggleGroupRules() {
    if (currentFilter === 'all' || currentFilter === 'global') return;
    
    let groupRules = config.headers.filter(h => h.group_id === currentFilter);
    if (groupRules.length === 0) return;
    
    // Check if all rules are ON - if yes, turn all OFF; otherwise turn all ON
    let allOn = groupRules.every(r => r.status === 'on');
    let newStatus = allOn ? 'off' : 'on';
    
    groupRules.forEach(rule => {
        rule.status = newStatus;
    });
    
    renderRules();
    scheduleAutoSave();
}

// ===========================
// RULES RENDERING
// ===========================

function getFilteredRules(rules, searchTerm) {
    if (!searchTerm) return rules;
    searchTerm = searchTerm.toLowerCase();
    return rules.filter(rule =>
        (rule.header_name && rule.header_name.toLowerCase().includes(searchTerm)) ||
        (rule.header_value && rule.header_value.toLowerCase().includes(searchTerm)) ||
        (rule.comment && rule.comment.toLowerCase().includes(searchTerm)) ||
        (rule.url_contains && rule.url_contains.toLowerCase().includes(searchTerm)) ||
        (rule.action && rule.action.toLowerCase().includes(searchTerm))
    );
}

function renderRules() {
    let globalRules = config.headers.filter(h => !h.group_id);
    let globalSection = document.getElementById('global_rules_section');
    let groupSection = document.getElementById('group_rules_section');
    let allGroupsSections = document.getElementById('all_groups_sections');
    let filterLabel = document.getElementById('current_filter_label');
    let filterInfo = document.getElementById('filter_info');
    let searchInput = document.getElementById('search_rules');
    let searchTerm = searchInput.value.trim();

    // Clear dynamic group sections
    allGroupsSections.innerHTML = '';

    // Determine what to show
    if (currentFilter === 'all') {
        globalSection.hidden = false;
        globalSection.classList.remove('collapsed');
        groupSection.hidden = true;
        searchInput.hidden = false;
        filterLabel.textContent = 'All Rules';

        let filteredGlobal = getFilteredRules(globalRules, searchTerm);
        renderRulesTable('global_rules_tab', filteredGlobal, true);

        let totalRules = filteredGlobal.length;

        // Render each group section
        if (config.groups) {
            config.groups.forEach(group => {
                let groupRules = config.headers.filter(h => h.group_id === group.id);
                let filteredGroupRules = getFilteredRules(groupRules, searchTerm);
                totalRules += filteredGroupRules.length;

                let section = document.createElement('div');
                section.className = 'rules-section';
                section.innerHTML = `
                    <div class="section-header">
                        <h4>
                            <span class="group-color-dot" style="background:${group.color}"></span>
                            ${escapeHtml(group.name)}
                            ${group.status === 'off' ? '<small>(disabled)</small>' : ''}
                        </h4>
                        <div class="section-actions">
                            <button type="button" class="btn btn-warning btn-sm toggle-group-btn" data-group-id="${group.id}" title="Enable/Disable all">
                                <span class="glyphicon glyphicon-off"></span>
                            </button>
                            <button type="button" class="btn btn-default btn-sm edit-group-inline-btn" data-group-id="${group.id}" title="Edit Group">
                                <span class="glyphicon glyphicon-pencil"></span>
                            </button>
                        </div>
                    </div>
                    <table class="rules-table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>URL Filter</th>
                                <th>Action</th>
                                <th>Header Name</th>
                                <th>Header Value</th>
                                <th class="col-comment">Comment</th>
                                <th>Apply On</th>
                                <th>Status</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="group_tab_${group.id}">
                        </tbody>
                    </table>
                `;

                // Event listeners for group buttons
                section.querySelector('.toggle-group-btn').addEventListener('click', function() {
                    toggleGroupRulesById(this.dataset.groupId);
                });
                section.querySelector('.edit-group-inline-btn').addEventListener('click', function() {
                    openEditGroupEditor(this.dataset.groupId);
                });

                allGroupsSections.appendChild(section);
                renderRulesTable('group_tab_' + group.id, filteredGroupRules, false);
            });
        }

        filterInfo.textContent = `${totalRules} rules`;
    } else if (currentFilter === 'global') {
        globalSection.hidden = false;
        globalSection.classList.remove('collapsed');
        groupSection.hidden = true;
        searchInput.hidden = false;
        filterLabel.textContent = 'Global Rules';

        let filteredGlobal = getFilteredRules(globalRules, searchTerm);
        filterInfo.textContent = `${filteredGlobal.length} rules`;
        renderRulesTable('global_rules_tab', filteredGlobal, true);
    } else {
        // Show specific group
        let group = config.groups.find(g => g.id === currentFilter);
        if (!group) {
            currentFilter = 'all';
            renderRules();
            return;
        }

        globalSection.hidden = false;
        globalSection.classList.add('collapsed');
        groupSection.hidden = false;
        searchInput.hidden = false;

        let groupRules = config.headers.filter(h => h.group_id === currentFilter);
        let filteredGroupRules = getFilteredRules(groupRules, searchTerm);
        let filteredGlobalRules = getFilteredRules(globalRules, searchTerm);

        filterLabel.textContent = group.name;
        filterInfo.textContent = `${filteredGroupRules.length} group rules + ${filteredGlobalRules.length} global`;

        document.getElementById('group_rules_name').textContent = group.name + ' Rules';
        document.getElementById('group_color_dot').style.background = group.color;

        // Setup drop zone on group rules section
        setupGroupRulesDropZone(currentFilter);

        // Load inline group filters
        loadGroupFiltersInline(group);

        renderRulesTable('global_rules_tab', filteredGlobalRules, true);
        renderRulesTable('group_rules_tab', filteredGroupRules, false);
    }
}

function toggleGroupRulesById(groupId) {
    let groupRules = config.headers.filter(h => h.group_id === groupId);
    if (groupRules.length === 0) return;
    
    let allOn = groupRules.every(r => r.status === 'on');
    let newStatus = allOn ? 'off' : 'on';
    
    groupRules.forEach(rule => {
        rule.status = newStatus;
    });
    
    renderRules();
    scheduleAutoSave();
}

function renderRulesTable(tbodyId, rules, showGroupColumn) {
    let tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';

    rules.forEach(rule => {
        let tr = document.createElement('tr');
        tr.dataset.ruleId = rule.id;

        let groupBadge = '';
        if (showGroupColumn && rule.group_id) {
            let group = config.groups.find(g => g.id === rule.group_id);
            if (group) {
                groupBadge = `<span class="rule-group-badge">
                    <span class="group-color-dot" style="background:${group.color}"></span>
                    ${escapeHtml(group.name)}
                </span>`;
            }
        }

        // Build URL Filter field - show select if group has users_url_filter options
        let urlFilterHtml = '';
        if (rule.group_id) {
            let group = config.groups.find(g => g.id === rule.group_id);
            if (group && group.users_url_filter && group.users_url_filter.length > 0) {
                let options = '<option value="">(none)</option>';
                if (group.default_url_filter) {
                    options += `<option value="${escapeHtml(group.default_url_filter)}">${escapeHtml(group.default_url_filter)} (default)</option>`;
                }
                group.users_url_filter.forEach(filter => {
                    let selected = rule.url_contains === filter ? 'selected' : '';
                    options += `<option value="${escapeHtml(filter)}" ${selected}>${escapeHtml(filter)}</option>`;
                });
                // Add custom option if current value is not in the list
                if (rule.url_contains && !group.users_url_filter.includes(rule.url_contains) && rule.url_contains !== group.default_url_filter) {
                    options += `<option value="${escapeHtml(rule.url_contains)}" selected>${escapeHtml(rule.url_contains)} (custom)</option>`;
                }
                urlFilterHtml = `
                    <select class="rule-select rule-url-contains-select">
                        ${options}
                        <option value="__custom__">Custom...</option>
                    </select>
                    <input class="rule-input rule-url-contains-custom" value="${escapeHtml(rule.url_contains)}" placeholder="custom filter" style="display:none; margin-top:4px; width:100%">
                `;
            } else {
                urlFilterHtml = `<input class="rule-input rule-url-contains" value="${escapeHtml(rule.url_contains)}" placeholder="optional filter">`;
            }
        } else {
            urlFilterHtml = `<input class="rule-input rule-url-contains" value="${escapeHtml(rule.url_contains)}" placeholder="optional filter">`;
        }

        tr.innerHTML = `
            <td class="drag-handle" title="Drag to reorder rule">
                <span class="glyphicon glyphicon-move"></span>
            </td>
            <td title="Filter by URL pattern (optional)">
                ${urlFilterHtml}
            </td>
            <td title="Action: Add, Modify, or Delete header">
                <select class="rule-select rule-action">
                    <option value="add">Add</option>
                    <option value="modify">Modify</option>
                    <option value="delete">Delete</option>
                    ${!useManifestV3 ? `
                    <option value="cookie_add_or_modify">Cookie Add/Modify</option>
                    <option value="cookie_delete">Cookie Delete</option>
                    ` : ''}
                </select>
            </td>
            <td title="HTTP header name (e.g. Authorization, Content-Type)">
                <input class="rule-input rule-header-name" value="${escapeHtml(rule.header_name)}" placeholder="Header-Name" list="header_names_list">
            </td>
            <td title="Header value to set">
                <input class="rule-input rule-header-value" value="${escapeHtml(rule.header_value)}" placeholder="value">
            </td>
            <td class="col-comment" ${show_comments ? '' : 'style="display:none"'} title="Optional comment">
                <input class="rule-input rule-comment" value="${escapeHtml(rule.comment)}" placeholder="comment">
            </td>
            <td title="Apply to Request or Response headers">
                <select class="rule-select rule-apply-on">
                    <option value="req">Request</option>
                    <option value="res">Response</option>
                </select>
            </td>
            <td title="Click to enable/disable this rule">
                <button type="button" class="rule-status-btn ${rule.status === 'on' ? 'on' : 'off'}">
                    ${rule.status === 'on' ? 'ON' : 'OFF'}
                </button>
            </td>
            ${showGroupColumn ? `<td title="Group this rule belongs to">${groupBadge}</td>` : ''}
            <td>
                <button type="button" class="rule-btn rule-btn-duplicate" title="Duplicate this rule">
                    <span class="glyphicon glyphicon-duplicate"></span>
                </button>
                <button type="button" class="rule-btn rule-btn-delete" title="Delete this rule">
                    <span class="glyphicon glyphicon-trash"></span>
                </button>
            </td>
        `;

        // Set select values
        tr.querySelector('.rule-action').value = rule.action;
        tr.querySelector('.rule-apply-on').value = rule.apply_on;

        // Event listeners
        tr.querySelector('.rule-status-btn').addEventListener('click', function () {
            toggleRuleStatus(rule.id, this);
        });

        tr.querySelector('.rule-btn-delete').addEventListener('click', function () {
            deleteRule(rule.id);
        });

        tr.querySelector('.rule-btn-duplicate').addEventListener('click', function () {
            duplicateRule(rule.id);
        });

        // Handle URL filter select/custom input toggle
        let urlSelect = tr.querySelector('.rule-url-contains-select');
        let urlCustomInput = tr.querySelector('.rule-url-contains-custom');
        if (urlSelect && urlCustomInput) {
            // Set initial value
            if (rule.url_contains && !Array.from(urlSelect.options).some(o => o.value === rule.url_contains && o.value !== '__custom__')) {
                urlSelect.value = '__custom__';
                urlCustomInput.style.display = 'block';
            } else if (rule.url_contains) {
                urlSelect.value = rule.url_contains;
            }

            urlSelect.addEventListener('change', function() {
                if (this.value === '__custom__') {
                    urlCustomInput.style.display = 'block';
                    urlCustomInput.focus();
                } else {
                    urlCustomInput.style.display = 'none';
                    urlCustomInput.value = this.value;
                    updateRuleFromRow(rule.id, tr);
                }
            });

            urlCustomInput.addEventListener('change', function() {
                updateRuleFromRow(rule.id, tr);
            });
        }

        // Drag and drop
        tr.setAttribute('draggable', 'true');
        tr.addEventListener('dragstart', handleDragStart);
        tr.addEventListener('dragover', handleDragOver);
        tr.addEventListener('dragenter', handleDragEnter);
        tr.addEventListener('dragleave', handleDragLeave);
        tr.addEventListener('drop', handleDrop);
        tr.addEventListener('dragend', handleDragEnd);

        // Update rule on input change
        tr.querySelectorAll('input, select').forEach(el => {
            el.addEventListener('change', function () {
                updateRuleFromRow(rule.id, tr);
            });
        });

        tbody.appendChild(tr);
    });
}

// ===========================
// RULE OPERATIONS
// ===========================

function addNewRule() {
    let groupId = null;
    if (currentFilter !== 'all' && currentFilter !== 'global') {
        groupId = currentFilter;
    }

    // Get default_url_filter from group
    let defaultUrlFilter = '';
    if (groupId) {
        let group = config.groups.find(g => g.id === groupId);
        if (group && group.default_url_filter) {
            defaultUrlFilter = group.default_url_filter;
        }
    }

    let newRule = {
        id: 'rule_' + ruleIdCounter++,
        group_id: groupId,
        url_contains: defaultUrlFilter,
        action: 'add',
        header_name: '',
        header_value: '',
        comment: '',
        apply_on: 'req',
        status: 'off'
    };

    config.headers.push(newRule);
    renderRules();
    updateBadges();
    scheduleAutoSave();

    // Focus the new rule's header name input
    setTimeout(() => {
        let rows = document.querySelectorAll(`tr[data-rule-id="${newRule.id}"]`);
        let lastRow = rows[rows.length - 1];
        if (lastRow) {
            let input = lastRow.querySelector('.rule-header-name');
            if (input) input.focus();
        }
    }, 50);
}

function deleteRule(ruleId) {
    let rule = config.headers.find(h => h.id === ruleId);
    let ruleName = rule ? (rule.header_name || '(empty)') : '';
    if (!confirm(`Delete rule "${ruleName}"?`)) return;
    
    config.headers = config.headers.filter(h => h.id !== ruleId);
    renderRules();
    updateBadges();
    scheduleAutoSave();
}

function duplicateRule(ruleId) {
    let rule = config.headers.find(h => h.id === ruleId);
    if (!rule) return;

    let newRule = {
        id: 'rule_' + ruleIdCounter++,
        group_id: rule.group_id,
        url_contains: rule.url_contains,
        action: rule.action,
        header_name: rule.header_name,
        header_value: rule.header_value,
        comment: rule.comment ? rule.comment + ' (copy)' : '(copy)',
        apply_on: rule.apply_on,
        status: rule.status
    };

    // Insert after the original rule
    let idx = config.headers.findIndex(h => h.id === ruleId);
    if (idx !== -1) {
        config.headers.splice(idx + 1, 0, newRule);
    } else {
        config.headers.push(newRule);
    }

    renderRules();
    updateBadges();
    scheduleAutoSave();
}

function toggleRuleStatus(ruleId, button) {
    let rule = config.headers.find(h => h.id === ruleId);
    if (!rule) return;

    rule.status = rule.status === 'on' ? 'off' : 'on';
    button.className = 'rule-status-btn ' + rule.status;
    button.textContent = rule.status === 'on' ? 'ON' : 'OFF';
    scheduleAutoSave();
}

// ===========================
// DRAG AND DROP
// ===========================

let draggedRow = null;
let draggedRuleId = null;
let draggedGroupId = null;

function handleDragStart(e) {
    draggedRow = this;
    draggedRuleId = this.dataset.ruleId;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedRuleId);
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    if (this !== draggedRow) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('drag-over');

    if (draggedRow === this) return;

    let targetRuleId = this.dataset.ruleId;
    if (!draggedRuleId || !targetRuleId) return;

    // Find indices in config
    let fromIdx = config.headers.findIndex(h => h.id === draggedRuleId);
    let toIdx = config.headers.findIndex(h => h.id === targetRuleId);
    if (fromIdx === -1 || toIdx === -1) return;

    // Move in config array
    let [movedRule] = config.headers.splice(fromIdx, 1);
    config.headers.splice(toIdx, 0, movedRule);

    // Clear drag state
    draggedRuleId = null;
    draggedRow = null;

    // Re-render
    renderRules();
    scheduleAutoSave();
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('.drag-over, .drop-target').forEach(el => el.classList.remove('drag-over', 'drop-target'));
    draggedRow = null;
    draggedRuleId = null;
    draggedGroupId = null;
}

function updateRuleFromRow(ruleId, tr) {
    let rule = config.headers.find(h => h.id === ruleId);
    if (!rule) return;

    // Handle URL filter - could be input or select
    let urlSelect = tr.querySelector('.rule-url-contains-select');
    let urlCustomInput = tr.querySelector('.rule-url-contains-custom');
    let urlInput = tr.querySelector('.rule-url-contains');

    if (urlSelect && urlCustomInput) {
        if (urlSelect.value === '__custom__') {
            rule.url_contains = urlCustomInput.value;
        } else {
            rule.url_contains = urlSelect.value;
        }
    } else if (urlInput) {
        rule.url_contains = urlInput.value;
    }

    rule.action = tr.querySelector('.rule-action').value;
    rule.header_name = tr.querySelector('.rule-header-name').value;
    rule.header_value = tr.querySelector('.rule-header-value').value;
    rule.apply_on = tr.querySelector('.rule-apply-on').value;

    let commentEl = tr.querySelector('.rule-comment');
    if (commentEl) rule.comment = commentEl.value;

    scheduleAutoSave();
}

// ===========================
// SAVE / LOAD
// ===========================

function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(function () {
        syncAllRowsToConfig();
        let toSave = {
            format_version: '2.0',
            groups: config.groups,
            headers: config.headers,
            debug_mode: debug_mode,
            show_comments: show_comments
        };
        storeInBrowserStorage({ config: JSON.stringify(toSave) }, function () {
            if (started === 'on') {
                if (useManifestV3) applyConfigWithManifestV3();
                else chrome.runtime.sendMessage('reload');
            }
            debug('Auto-saved config');
        });
    }, 1000);
}

function saveData() {
    // Sync all rows to config before saving
    syncAllRowsToConfig();

    let toSave = {
        format_version: '2.0',
        groups: config.groups,
        headers: config.headers,
        debug_mode: debug_mode,
        show_comments: show_comments
    };

    storeInBrowserStorage({ config: JSON.stringify(toSave) }, function () {
        if (useManifestV3) applyConfigWithManifestV3();
        else chrome.runtime.sendMessage('reload');

        // Visual feedback
        let btn = document.getElementById('save_button');
        let originalText = btn.innerHTML;
        btn.innerHTML = '<span class="glyphicon glyphicon-ok"></span> Saved!';
        btn.classList.add('btn-success');
        btn.classList.remove('btn-primary');
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('btn-success');
            btn.classList.add('btn-primary');
        }, 1500);
    });
}

function syncAllRowsToConfig() {
    document.querySelectorAll('#global_rules_tab tr, #group_rules_tab tr, #all_groups_sections tbody[id^="group_tab_"] tr').forEach(tr => {
        let ruleId = tr.dataset.ruleId;
        if (ruleId) updateRuleFromRow(ruleId, tr);
    });
}

// ===========================
// START / STOP
// ===========================

function startModify() {
    if (started === 'off') {
        syncAllRowsToConfig();
        let toSave = {
            format_version: '2.0',
            groups: config.groups,
            headers: config.headers,
            debug_mode: debug_mode,
            show_comments: show_comments
        };
        storeInBrowserStorage({ config: JSON.stringify(toSave) }, function () {
            storeInBrowserStorage({ started: 'on' }, function () {
                started = 'on';
                updateStartStopIcon();
                if (useManifestV3) applyConfigWithManifestV3();
                else chrome.runtime.sendMessage('on');
            });
        });
    } else {
        storeInBrowserStorage({ started: 'off' }, function () {
            started = 'off';
            updateStartStopIcon();
            if (useManifestV3) removeConfigWithManifestV3();
            else chrome.runtime.sendMessage('off');
        });
    }
}

function updateStartStopIcon() {
    const btn = document.getElementById('start_stop_btn');
    if (started === 'on') {
        btn.textContent = I18n.t('btnStop');
        btn.classList.add('stopped');
    } else {
        btn.textContent = I18n.t('btnStart');
        btn.classList.remove('stopped');
    }
}

// ===========================
// PARAMETERS SCREEN
// ===========================

function showParametersScreen() {
    document.getElementById('main_screen') && (document.getElementById('main_screen').hidden = true);
    document.querySelector('.app-body').hidden = true;
    document.querySelector('.app-footer').hidden = true;
    document.getElementById('parameters_screen').hidden = false;
}

function hideParametersScreen() {
    document.querySelector('.app-body').hidden = false;
    document.querySelector('.app-footer').hidden = false;
    document.getElementById('parameters_screen').hidden = true;
}

// ===========================
// IMPORT / EXPORT
// ===========================

function exportData() {
    syncAllRowsToConfig();

    let toExport = {
        format_version: '2.0',
        groups: config.groups,
        headers: config.headers,
        debug_mode: debug_mode,
        show_comments: show_comments
    };

    let a = document.createElement('a');
    a.href = 'data:attachment/json,' + encodeURIComponent(JSON.stringify(toExport));
    a.target = 'download';
    a.download = 'ModifyHeadersPlus.conf';

    let myf = document.getElementById('download');
    myf = myf.contentWindow.document || myf.contentDocument;
    myf.body.appendChild(a);
    a.click();
}

function importData() {
    if (window.confirm('This will erase your actual configuration, do you want to continue?')) {
        openFile(true);
    }
}

function appendData() {
    if (window.confirm('This will append data to your actual configuration, do you want to continue?')) {
        openFile(false);
    }
}

function openFile(replace) {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = '.conf';
    input.addEventListener('change', function (e) {
        readSingleFile(e, replace);
    }, false);
    let myf = document.getElementById('download');
    myf = myf.contentWindow.document || myf.contentDocument;
    myf.body.appendChild(input);
    input.click();
}

function readSingleFile(e, replace) {
    let file = e.target.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = function (e) {
        loadConfiguration(e.target.result, replace);
    };
    reader.readAsText(file);
}

function loadConfiguration(configuration, replace) {
    let imported;
    try {
        imported = JSON.parse(configuration);
        imported = migrateConfig(imported);
        if (useManifestV3) imported = removeCookiesActionFromConfig(imported);
    } catch (error) {
        console.log(error);
        alert('Invalid file format');
        return;
    }

    if (replace) {
        config = imported;
    } else {
        // Append: merge groups and headers
        if (imported.groups) {
            imported.groups.forEach(g => {
                // Avoid duplicate group ids
                let existing = config.groups.find(eg => eg.id === g.id);
                if (existing) {
                    g.id = 'group_' + groupIdCounter++;
                }
                config.groups.push(g);
            });
        }
        imported.headers.forEach(h => {
            h.id = 'rule_' + ruleIdCounter++;
            config.headers.push(h);
        });
    }

    // Save and reload
    let toSave = {
        format_version: '2.0',
        groups: config.groups,
        headers: config.headers,
        debug_mode: config.debug_mode || debug_mode,
        show_comments: config.show_comments !== undefined ? config.show_comments : show_comments
    };

    storeInBrowserStorage({ config: JSON.stringify(toSave) }, function () {
        if (useManifestV3) applyConfigWithManifestV3();
        else chrome.runtime.sendMessage('reload');
        document.location.href = 'config.html';
    });
}

// ===========================
// UTILITIES
// ===========================

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debug(message) {
    if (debug_mode) console.log(new Date() + ' ModifyHeadersPlus : ' + message);
}

function isValidUrlPattern(pattern) {
    if (!pattern || pattern.trim() === '') return true;
    pattern = pattern.trim();
    
    // Wildcard alone is valid
    if (pattern === '*') return true;
    
    // Check Chrome match pattern syntax: scheme://host/path
    // scheme: http, https, or *
    // host: *, *.<domain>, or exact domain
    // path: any string, can contain *
    let regex = /^(https?|\*)\:\/\/([^\/]+)(\/.*)?$/;
    let match = pattern.match(regex);
    
    if (!match) return false;
    
    let scheme = match[1];
    let host = match[2];
    
    // Validate host
    if (host !== '*') {
        // Can be *.domain.com or domain.com
        if (host.startsWith('*.')) {
            // Wildcard subdomain
            let domain = host.slice(2);
            if (!domain || domain.includes('*')) return false;
        }
        // No other wildcards allowed in host
        if (host.includes('*') && !host.startsWith('*.')) return false;
    }
    
    return true;
}

function validateUrlPatternInput(input) {
    let value = input.value.trim();
    if (isValidUrlPattern(value)) {
        input.style.borderColor = '';
        input.style.color = '';
        return true;
    } else {
        input.style.borderColor = '#F44336';
        input.style.color = '#F44336';
        return false;
    }
}

function addMockGroups() {
    const mockGroups = [
        {
            name: 'APIs Production',
            color: '#4CAF50',
            urls: ['https://api.production.com/*'],
            default_url_filter: 'api',
            users_url_filter: ['v1', 'v2', 'auth']
        },
        {
            name: 'Dev Local',
            color: '#2196F3',
            urls: ['http://localhost:*/*', 'http://127.0.0.1:*/*'],
            default_url_filter: '',
            users_url_filter: ['localhost', 'dev']
        },
        {
            name: 'Staging Environment',
            color: '#FF9800',
            urls: ['https://staging.example.com/*'],
            default_url_filter: 'staging',
            users_url_filter: ['test', 'preview']
        },
        {
            name: 'CDN & Assets',
            color: '#9C27B0',
            urls: ['https://cdn.example.com/*', 'https://assets.example.com/*'],
            default_url_filter: '',
            users_url_filter: ['images', 'scripts', 'styles']
        }
    ];

    const mockRules = {
        'APIs Production': [
            { header_name: 'Authorization', header_value: 'Bearer prod-token-123', action: 'add', apply_on: 'req', comment: 'Production auth token' },
            { header_name: 'X-API-Key', header_value: 'key-prod-abc', action: 'add', apply_on: 'req', comment: 'API key for production' },
            { header_name: 'X-Request-ID', header_value: 'req-{{timestamp}}', action: 'add', apply_on: 'req', comment: 'Request tracing' },
            { header_name: 'Cache-Control', header_value: 'no-cache', action: 'modify', apply_on: 'req', comment: 'Disable cache for API' },
            { header_name: 'X-RateLimit-Limit', header_value: '1000', action: 'add', apply_on: 'res', comment: 'Rate limit header' }
        ],
        'Dev Local': [
            { header_name: 'X-Debug-Mode', header_value: 'true', action: 'add', apply_on: 'req', comment: 'Enable debug mode' },
            { header_name: 'Origin', header_value: 'http://localhost:3000', action: 'modify', apply_on: 'req', comment: 'CORS origin override' },
            { header_name: 'X-Forwarded-For', header_value: '127.0.0.1', action: 'add', apply_on: 'req', comment: 'Local IP header' },
            { header_name: 'Accept', header_value: 'application/json', action: 'modify', apply_on: 'req', comment: 'Force JSON response' },
            { header_name: 'X-Dev-User', header_value: 'admin@test.com', action: 'add', apply_on: 'req', comment: 'Dev user impersonation' }
        ],
        'Staging Environment': [
            { header_name: 'X-Environment', header_value: 'staging', action: 'add', apply_on: 'req', comment: 'Identify staging env' },
            { header_name: 'Authorization', header_value: 'Bearer staging-token', action: 'add', apply_on: 'req', comment: 'Staging auth' },
            { header_name: 'X-Feature-Flag', header_value: 'new-feature-v2', action: 'add', apply_on: 'req', comment: 'Feature flag toggle' },
            { header_name: 'Content-Security-Policy', header_value: "default-src 'self'", action: 'add', apply_on: 'res', comment: 'CSP for staging' },
            { header_name: 'X-Frame-Options', header_value: 'DENY', action: 'add', apply_on: 'res', comment: 'Clickjacking protection' }
        ],
        'CDN & Assets': [
            { header_name: 'Access-Control-Allow-Origin', header_value: '*', action: 'add', apply_on: 'res', comment: 'CORS for CDN' },
            { header_name: 'Cache-Control', header_value: 'public, max-age=31536000', action: 'add', apply_on: 'res', comment: 'Long cache for assets' },
            { header_name: 'X-Content-Type-Options', header_value: 'nosniff', action: 'add', apply_on: 'res', comment: 'MIME type sniffing' },
            { header_name: 'Vary', header_value: 'Accept-Encoding', action: 'add', apply_on: 'res', comment: 'Vary header for CDN' },
            { header_name: 'ETag', header_value: '"mock-etag-123"', action: 'modify', apply_on: 'res', comment: 'ETag override' }
        ]
    };

    let counter = Date.now();

    mockGroups.forEach(groupData => {
        const groupId = 'group_' + counter++;
        const group = {
            id: groupId,
            name: groupData.name,
            color: groupData.color,
            urls: groupData.urls,
            default_url_filter: groupData.default_url_filter,
            users_url_filter: groupData.users_url_filter,
            status: 'on'
        };
        config.groups.push(group);

        const rules = mockRules[groupData.name] || [];
        rules.forEach(ruleData => {
            config.headers.push({
                id: 'rule_' + counter++,
                group_id: groupId,
                url_contains: groupData.default_url_filter || '',
                action: ruleData.action,
                header_name: ruleData.header_name,
                header_value: ruleData.header_value,
                comment: ruleData.comment,
                apply_on: ruleData.apply_on,
                status: 'off'
            });
        });
    });

    saveData();
    renderGroupsList();
    renderRules();
    updateBadges();
    alert('4 mock groups added successfully!');
}
