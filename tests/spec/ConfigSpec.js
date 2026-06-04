describe('Config', function () {

    beforeEach(function () {
        resetConfigState();
        resetMockStorage();
        clearTestDom();
    });

    // ===========================
    // getDefaultConfig
    // ===========================

    describe('#getDefaultConfig', function () {
        it('should return a valid default config with format_version 2.0', function () {
            var result = getDefaultConfig();
            expect(result.format_version).toEqual('2.0');
            expect(result.groups).toEqual([]);
            expect(result.headers.length).toEqual(1);
            expect(result.debug_mode).toEqual(false);
            expect(result.show_comments).toEqual(true);
        });

        it('should create a default header with correct fields', function () {
            var result = getDefaultConfig();
            var header = result.headers[0];
            expect(header.id).toEqual('rule_1');
            expect(header.group_id).toBeNull();
            expect(header.action).toEqual('add');
            expect(header.header_name).toEqual('test-header-name');
            expect(header.header_value).toEqual('test-header-value');
            expect(header.comment).toEqual('test');
            expect(header.apply_on).toEqual('req');
            expect(header.status).toEqual('on');
        });
    });

    // ===========================
    // migrateConfig
    // ===========================

    describe('#migrateConfig', function () {
        it('should return v2.0 config unchanged', function () {
            var cfg = createTestConfig();
            var result = migrateConfig(cfg);
            expect(result.format_version).toEqual('2.0');
            expect(result.groups.length).toEqual(1);
            expect(result.headers.length).toEqual(3);
        });

        it('should add default_url_filter and users_url_filter to v2.0 groups missing them', function () {
            var cfg = createTestConfig();
            delete cfg.groups[0].default_url_filter;
            delete cfg.groups[0].users_url_filter;
            var result = migrateConfig(cfg);
            expect(result.groups[0].default_url_filter).toEqual('');
            expect(result.groups[0].users_url_filter).toEqual([]);
        });

        it('should migrate v1.2 config to v2.0', function () {
            var cfg = {
                format_version: '1.2',
                target_page: 'https://example.com/*',
                debug_mode: true,
                show_comments: false,
                headers: [
                    { action: 'add', header_name: 'X-Test', header_value: 'val', comment: 'c', apply_on: 'req', url_contains: 'api', status: 'on' }
                ]
            };
            var result = migrateConfig(cfg);
            expect(result.format_version).toEqual('2.0');
            expect(result.groups.length).toEqual(1);
            expect(result.groups[0].urls).toEqual(['https://example.com/*']);
            expect(result.headers[0].group_id).toEqual(result.groups[0].id);
            expect(result.debug_mode).toEqual(true);
            expect(result.show_comments).toEqual(false);
        });

        it('should migrate v1.2 config with no target_page to global rules', function () {
            var cfg = {
                format_version: '1.2',
                target_page: '',
                headers: [
                    { action: 'add', header_name: 'X-Global', header_value: 'val', comment: '', apply_on: 'req', status: 'on' }
                ]
            };
            var result = migrateConfig(cfg);
            expect(result.groups.length).toEqual(0);
            expect(result.headers[0].group_id).toBeNull();
        });

        it('should migrate v1.0 config correctly', function () {
            var cfg = {
                format_version: '1.0',
                target_page: 'https://example.com/*',
                headers: [
                    { action: 'add', header_name: 'X-Test', header_value: 'val', comment: 'c', status: 'on' }
                ]
            };
            var result = migrateConfig(cfg);
            expect(result.format_version).toEqual('2.0');
            expect(result.headers[0].apply_on).toEqual('req');
        });
    });

    // ===========================
    // removeCookiesActionFromConfig
    // ===========================

    describe('#removeCookiesActionFromConfig', function () {
        it('should remove cookie_add_or_modify actions', function () {
            var cfg = createTestConfig();
            cfg.headers.push({
                id: 'rule_cookie',
                group_id: null,
                url_contains: '',
                action: 'cookie_add_or_modify',
                header_name: 'Cookie',
                header_value: 'test=1',
                comment: '',
                apply_on: 'req',
                status: 'on'
            });
            var result = removeCookiesActionFromConfig(cfg);
            expect(result.headers.length).toEqual(3);
            expect(result.headers.find(h => h.action === 'cookie_add_or_modify')).toBeUndefined();
        });

        it('should remove cookie_delete actions', function () {
            var cfg = createTestConfig();
            cfg.headers.push({
                id: 'rule_cookie_del',
                group_id: null,
                url_contains: '',
                action: 'cookie_delete',
                header_name: 'Cookie',
                header_value: '',
                comment: '',
                apply_on: 'req',
                status: 'on'
            });
            var result = removeCookiesActionFromConfig(cfg);
            expect(result.headers.find(h => h.action === 'cookie_delete')).toBeUndefined();
        });

        it('should keep non-cookie actions', function () {
            var cfg = createTestConfig();
            var result = removeCookiesActionFromConfig(cfg);
            expect(result.headers.length).toEqual(3);
        });
    });

    // ===========================
    // addNewRule
    // ===========================

    describe('#addNewRule', function () {
        beforeEach(function () {
            config = createTestConfig();
            ruleIdCounter = 100;
            currentFilter = 'all';
        });

        it('should add a new rule to config.headers', function () {
            addNewRule();
            expect(config.headers.length).toEqual(4);
        });

        it('should create rule with correct default fields', function () {
            addNewRule();
            var newRule = config.headers[3];
            expect(newRule.id).toEqual('rule_100');
            expect(newRule.group_id).toBeNull();
            expect(newRule.action).toEqual('add');
            expect(newRule.header_name).toEqual('');
            expect(newRule.header_value).toEqual('');
            expect(newRule.comment).toEqual('');
            expect(newRule.apply_on).toEqual('req');
            expect(newRule.status).toEqual('off');
        });

        it('should assign group_id when filter is set to a group', function () {
            currentFilter = 'group_1';
            addNewRule();
            var newRule = config.headers[3];
            expect(newRule.group_id).toEqual('group_1');
        });

        it('should set default_url_filter from group when filter is set', function () {
            currentFilter = 'group_1';
            addNewRule();
            var newRule = config.headers[3];
            expect(newRule.url_contains).toEqual('api');
        });

        it('should not assign group_id when filter is global', function () {
            currentFilter = 'global';
            addNewRule();
            var newRule = config.headers[3];
            expect(newRule.group_id).toBeNull();
        });

        it('should increment ruleIdCounter', function () {
            addNewRule();
            expect(ruleIdCounter).toEqual(101);
            addNewRule();
            expect(ruleIdCounter).toEqual(102);
        });

        it('should call scheduleAutoSave (bug fix verification)', function () {
            spyOn(window, 'scheduleAutoSave');
            addNewRule();
            expect(scheduleAutoSave).toHaveBeenCalled();
        });
    });

    // ===========================
    // deleteRule
    // ===========================

    describe('#deleteRule', function () {
        beforeEach(function () {
            config = createTestConfig();
        });

        it('should remove the rule with the given id', function () {
            spyOn(window, 'confirm').and.returnValue(true);
            deleteRule('rule_2');
            expect(config.headers.length).toEqual(2);
            expect(config.headers.find(h => h.id === 'rule_2')).toBeUndefined();
        });

        it('should not remove anything if confirm is cancelled', function () {
            spyOn(window, 'confirm').and.returnValue(false);
            deleteRule('rule_2');
            expect(config.headers.length).toEqual(3);
        });

        it('should call scheduleAutoSave after deletion', function () {
            spyOn(window, 'confirm').and.returnValue(true);
            spyOn(window, 'scheduleAutoSave');
            deleteRule('rule_2');
            expect(scheduleAutoSave).toHaveBeenCalled();
        });
    });

    // ===========================
    // duplicateRule
    // ===========================

    describe('#duplicateRule', function () {
        beforeEach(function () {
            config = createTestConfig();
            ruleIdCounter = 100;
        });

        it('should duplicate a rule and insert after original', function () {
            duplicateRule('rule_1');
            expect(config.headers.length).toEqual(4);
            var idx = config.headers.findIndex(h => h.id === 'rule_1');
            expect(config.headers[idx + 1].header_name).toEqual('X-Test');
            expect(config.headers[idx + 1].comment).toEqual('test comment (copy)');
        });

        it('should give the duplicate a new id', function () {
            duplicateRule('rule_1');
            var dup = config.headers.find(h => h.id === 'rule_100');
            expect(dup).toBeDefined();
        });

        it('should copy all fields from original', function () {
            duplicateRule('rule_2');
            var dup = config.headers.find(h => h.id === 'rule_100');
            expect(dup.group_id).toEqual('group_1');
            expect(dup.url_contains).toEqual('api');
            expect(dup.action).toEqual('modify');
            expect(dup.header_name).toEqual('Authorization');
            expect(dup.header_value).toEqual('Bearer token');
            expect(dup.apply_on).toEqual('req');
            expect(dup.status).toEqual('on');
        });

        it('should append (copy) to comment', function () {
            duplicateRule('rule_3');
            var dup = config.headers.find(h => h.id === 'rule_100');
            expect(dup.comment).toEqual('(copy)');
        });

        it('should call scheduleAutoSave after duplication', function () {
            spyOn(window, 'scheduleAutoSave');
            duplicateRule('rule_1');
            expect(scheduleAutoSave).toHaveBeenCalled();
        });
    });

    // ===========================
    // toggleRuleStatus
    // ===========================

    describe('#toggleRuleStatus', function () {
        beforeEach(function () {
            config = createTestConfig();
        });

        it('should toggle status from on to off', function () {
            var btn = document.createElement('button');
            toggleRuleStatus('rule_1', btn);
            var rule = config.headers.find(h => h.id === 'rule_1');
            expect(rule.status).toEqual('off');
            expect(btn.className).toEqual('rule-status-btn off');
            expect(btn.textContent).toEqual('OFF');
        });

        it('should toggle status from off to on', function () {
            var btn = document.createElement('button');
            toggleRuleStatus('rule_3', btn);
            var rule = config.headers.find(h => h.id === 'rule_3');
            expect(rule.status).toEqual('on');
            expect(btn.className).toEqual('rule-status-btn on');
            expect(btn.textContent).toEqual('ON');
        });

        it('should call scheduleAutoSave after toggle', function () {
            spyOn(window, 'scheduleAutoSave');
            var btn = document.createElement('button');
            toggleRuleStatus('rule_1', btn);
            expect(scheduleAutoSave).toHaveBeenCalled();
        });
    });

    // ===========================
    // updateRuleFromRow
    // ===========================

    describe('#updateRuleFromRow', function () {
        beforeEach(function () {
            config = createTestConfig();
        });

        it('should update rule fields from DOM row inputs', function () {
            var tr = document.createElement('tr');
            tr.innerHTML = '<input class="rule-url-contains" value="new-url" />' +
                '<select class="rule-action"><option value="modify" selected>modify</option></select>' +
                '<input class="rule-header-name" value="X-New-Header" />' +
                '<input class="rule-header-value" value="new-value" />' +
                '<select class="rule-apply-on"><option value="res" selected>res</option></select>' +
                '<input class="rule-comment" value="new comment" />';

            updateRuleFromRow('rule_1', tr);

            var rule = config.headers.find(h => h.id === 'rule_1');
            expect(rule.url_contains).toEqual('new-url');
            expect(rule.action).toEqual('modify');
            expect(rule.header_name).toEqual('X-New-Header');
            expect(rule.header_value).toEqual('new-value');
            expect(rule.apply_on).toEqual('res');
            expect(rule.comment).toEqual('new comment');
        });

        it('should handle select for url_contains', function () {
            var tr = document.createElement('tr');
            tr.innerHTML = '<select class="rule-url-contains-select"><option value="api" selected>api</option></select>' +
                '<input class="rule-url-contains-custom" style="display:none" value="custom" />' +
                '<select class="rule-action"><option value="add" selected>add</option></select>' +
                '<input class="rule-header-name" value="H" />' +
                '<input class="rule-header-value" value="V" />' +
                '<select class="rule-apply-on"><option value="req" selected>req</option></select>';

            updateRuleFromRow('rule_1', tr);
            var rule = config.headers.find(h => h.id === 'rule_1');
            expect(rule.url_contains).toEqual('api');
        });

        it('should use custom input when select value is __custom__', function () {
            var tr = document.createElement('tr');
            tr.innerHTML = '<select class="rule-url-contains-select"><option value="__custom__" selected>Custom...</option></select>' +
                '<input class="rule-url-contains-custom" value="my-custom-url" />' +
                '<select class="rule-action"><option value="add" selected>add</option></select>' +
                '<input class="rule-header-name" value="H" />' +
                '<input class="rule-header-value" value="V" />' +
                '<select class="rule-apply-on"><option value="req" selected>req</option></select>';

            updateRuleFromRow('rule_1', tr);
            var rule = config.headers.find(h => h.id === 'rule_1');
            expect(rule.url_contains).toEqual('my-custom-url');
        });

        it('should call scheduleAutoSave after update', function () {
            spyOn(window, 'scheduleAutoSave');
            var tr = document.createElement('tr');
            tr.innerHTML = '<input class="rule-url-contains" value="" />' +
                '<select class="rule-action"><option value="add" selected>add</option></select>' +
                '<input class="rule-header-name" value="H" />' +
                '<input class="rule-header-value" value="V" />' +
                '<select class="rule-apply-on"><option value="req" selected>req</option></select>';

            updateRuleFromRow('rule_1', tr);
            expect(scheduleAutoSave).toHaveBeenCalled();
        });
    });

    // ===========================
    // syncAllRowsToConfig
    // ===========================

    describe('#syncAllRowsToConfig', function () {
        beforeEach(function () {
            config = createTestConfig();
        });

        it('should sync rows from global_rules_tab', function () {
            var tbody = document.getElementById('global_rules_tab');
            var tr = document.createElement('tr');
            tr.dataset.ruleId = 'rule_1';
            tr.innerHTML = '<input class="rule-url-contains" value="synced-url" />' +
                '<select class="rule-action"><option value="modify" selected>modify</option></select>' +
                '<input class="rule-header-name" value="Synced-Header" />' +
                '<input class="rule-header-value" value="synced-val" />' +
                '<select class="rule-apply-on"><option value="req" selected>req</option></select>';
            tbody.appendChild(tr);

            syncAllRowsToConfig();

            var rule = config.headers.find(h => h.id === 'rule_1');
            expect(rule.url_contains).toEqual('synced-url');
            expect(rule.header_name).toEqual('Synced-Header');
        });

        it('should sync rows from group_rules_tab', function () {
            var tbody = document.getElementById('group_rules_tab');
            var tr = document.createElement('tr');
            tr.dataset.ruleId = 'rule_2';
            tr.innerHTML = '<input class="rule-url-contains" value="group-synced" />' +
                '<select class="rule-action"><option value="add" selected>add</option></select>' +
                '<input class="rule-header-name" value="Group-Header" />' +
                '<input class="rule-header-value" value="group-val" />' +
                '<select class="rule-apply-on"><option value="res" selected>res</option></select>';
            tbody.appendChild(tr);

            syncAllRowsToConfig();

            var rule = config.headers.find(h => h.id === 'rule_2');
            expect(rule.url_contains).toEqual('group-synced');
            expect(rule.header_name).toEqual('Group-Header');
        });

        it('should sync rows from all_groups_sections (All Rules view)', function () {
            var container = document.getElementById('all_groups_sections');
            var section = document.createElement('div');
            section.innerHTML = '<tbody id="group_tab_group_1"></tbody>';
            container.appendChild(section);

            var tbody = document.getElementById('group_tab_group_1');
            var tr = document.createElement('tr');
            tr.dataset.ruleId = 'rule_2';
            tr.innerHTML = '<input class="rule-url-contains" value="all-view-synced" />' +
                '<select class="rule-action"><option value="add" selected>add</option></select>' +
                '<input class="rule-header-name" value="AllView-Header" />' +
                '<input class="rule-header-value" value="all-view-val" />' +
                '<select class="rule-apply-on"><option value="req" selected>req</option></select>';
            tbody.appendChild(tr);

            syncAllRowsToConfig();

            var rule = config.headers.find(h => h.id === 'rule_2');
            expect(rule.url_contains).toEqual('all-view-synced');
            expect(rule.header_name).toEqual('AllView-Header');
        });
    });

    // ===========================
    // scheduleAutoSave
    // ===========================

    describe('#scheduleAutoSave', function () {
        beforeEach(function () {
            config = createTestConfig();
            jasmine.clock().install();
        });

        afterEach(function () {
            jasmine.clock().uninstall();
        });

        it('should debounce and call storeInBrowserStorage after 1 second', function () {
            spyOn(chrome.storage.local, 'set');
            scheduleAutoSave();
            expect(chrome.storage.local.set).not.toHaveBeenCalled();
            jasmine.clock().tick(1000);
            expect(chrome.storage.local.set).toHaveBeenCalled();
        });

        it('should cancel previous timer if called again', function () {
            spyOn(chrome.storage.local, 'set');
            scheduleAutoSave();
            jasmine.clock().tick(500);
            scheduleAutoSave();
            jasmine.clock().tick(500);
            expect(chrome.storage.local.set).not.toHaveBeenCalled();
            jasmine.clock().tick(500);
            expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
        });
    });

    // ===========================
    // saveData
    // ===========================

    describe('#saveData', function () {
        beforeEach(function () {
            config = createTestConfig();
        });

        it('should save config to storage', function () {
            spyOn(chrome.storage.local, 'set');
            saveData();
            expect(chrome.storage.local.set).toHaveBeenCalled();
            var args = chrome.storage.local.set.calls.mostRecent().args[0];
            expect(args.config).toBeDefined();
            var saved = JSON.parse(args.config);
            expect(saved.format_version).toEqual('2.0');
            expect(saved.headers.length).toEqual(3);
        });
    });

    // ===========================
    // loadConfiguration
    // ===========================

    describe('#loadConfiguration', function () {
        it('should load and migrate v1.0 configuration', function () {
            var cfg = '{"format_version":"1.0","target_page":"https://example.com/*","headers":[{"action":"add","header_name":"X-Test","header_value":"val","comment":"c","status":"on"}]}';
            loadConfiguration(cfg, true);
            var saved = JSON.parse(mockStorage.config);
            expect(saved.format_version).toEqual('2.0');
            expect(saved.groups.length).toEqual(1);
            expect(saved.headers[0].apply_on).toEqual('req');
        });

        it('should load and migrate v1.2 configuration', function () {
            var cfg = '{"format_version":"1.2","target_page":"https://example.com/*","debug_mode":true,"headers":[{"url_contains":"api","action":"add","header_name":"X-Test","header_value":"val","comment":"c","apply_on":"res","status":"on"}]}';
            loadConfiguration(cfg, true);
            var saved = JSON.parse(mockStorage.config);
            expect(saved.format_version).toEqual('2.0');
            expect(saved.debug_mode).toEqual(true);
            expect(saved.headers[0].apply_on).toEqual('res');
        });

        it('should replace config when replace is true', function () {
            config = createTestConfig();
            var cfg = '{"format_version":"2.0","groups":[],"headers":[{"id":"new_1","group_id":null,"url_contains":"","action":"add","header_name":"Replaced","header_value":"yes","comment":"","apply_on":"req","status":"on"}],"debug_mode":false,"show_comments":true}';
            loadConfiguration(cfg, true);
            var saved = JSON.parse(mockStorage.config);
            expect(saved.headers.length).toEqual(1);
            expect(saved.headers[0].header_name).toEqual('Replaced');
        });

        it('should append headers when replace is false', function () {
            config = createTestConfig();
            ruleIdCounter = 100;
            var cfg = '{"format_version":"2.0","groups":[],"headers":[{"id":"new_1","group_id":null,"url_contains":"","action":"add","header_name":"Appended","header_value":"yes","comment":"","apply_on":"req","status":"on"}],"debug_mode":false,"show_comments":true}';
            loadConfiguration(cfg, false);
            var saved = JSON.parse(mockStorage.config);
            expect(saved.headers.length).toEqual(4);
            expect(saved.headers[3].header_name).toEqual('Appended');
            expect(saved.headers[3].id).toEqual('rule_100');
        });

        it('should alert on invalid JSON', function () {
            spyOn(window, 'alert');
            loadConfiguration('not valid json', true);
            expect(alert).toHaveBeenCalledWith('Invalid file format');
        });
    });

    // ===========================
    // getFilteredRules
    // ===========================

    describe('#getFilteredRules', function () {
        it('should return all rules if no search term', function () {
            var rules = [{ header_name: 'A' }, { header_name: 'B' }];
            expect(getFilteredRules(rules, '').length).toEqual(2);
            expect(getFilteredRules(rules, null).length).toEqual(2);
        });

        it('should filter by header_name', function () {
            var rules = [{ header_name: 'Authorization' }, { header_name: 'Content-Type' }];
            var result = getFilteredRules(rules, 'auth');
            expect(result.length).toEqual(1);
            expect(result[0].header_name).toEqual('Authorization');
        });

        it('should filter by header_value', function () {
            var rules = [
                { header_name: 'A', header_value: 'Bearer token' },
                { header_name: 'B', header_value: 'text/html' }
            ];
            var result = getFilteredRules(rules, 'bearer');
            expect(result.length).toEqual(1);
        });

        it('should filter by comment', function () {
            var rules = [
                { header_name: 'A', comment: 'auth header' },
                { header_name: 'B', comment: 'content type' }
            ];
            var result = getFilteredRules(rules, 'auth');
            expect(result.length).toEqual(1);
        });

        it('should be case insensitive', function () {
            var rules = [{ header_name: 'Authorization' }];
            var result = getFilteredRules(rules, 'AUTHORIZATION');
            expect(result.length).toEqual(1);
        });
    });

    // ===========================
    // isValidUrlPattern
    // ===========================

    describe('#isValidUrlPattern', function () {
        it('should validate empty pattern', function () {
            expect(isValidUrlPattern('')).toEqual(true);
            expect(isValidUrlPattern(null)).toEqual(true);
            expect(isValidUrlPattern(undefined)).toEqual(true);
        });

        it('should validate wildcard alone', function () {
            expect(isValidUrlPattern('*')).toEqual(true);
        });

        it('should validate http patterns', function () {
            expect(isValidUrlPattern('http://*/*')).toEqual(true);
            expect(isValidUrlPattern('http://example.com/*')).toEqual(true);
            expect(isValidUrlPattern('http://example.com/path')).toEqual(true);
        });

        it('should validate https patterns', function () {
            expect(isValidUrlPattern('https://*/*')).toEqual(true);
            expect(isValidUrlPattern('https://example.com/*')).toEqual(true);
        });

        it('should validate wildcard scheme', function () {
            expect(isValidUrlPattern('*://*/*')).toEqual(true);
        });

        it('should validate wildcard subdomain', function () {
            expect(isValidUrlPattern('https://*.example.com/*')).toEqual(true);
        });

        it('should reject invalid patterns', function () {
            expect(isValidUrlPattern('test')).toEqual(false);
            expect(isValidUrlPattern('*://*')).toEqual(false);
            expect(isValidUrlPattern('ftp://*/*')).toEqual(false);
        });

        it('should reject patterns with wildcards in domain', function () {
            expect(isValidUrlPattern('https://ex*ple.com/*')).toEqual(false);
        });
    });

    // ===========================
    // escapeHtml
    // ===========================

    describe('#escapeHtml', function () {
        it('should escape ampersand', function () {
            expect(escapeHtml('a&b')).toEqual('a&amp;b');
        });

        it('should escape less than', function () {
            expect(escapeHtml('a<b')).toEqual('a&lt;b');
        });

        it('should escape greater than', function () {
            expect(escapeHtml('a>b')).toEqual('a&gt;b');
        });

        it('should escape double quotes', function () {
            expect(escapeHtml('a"b')).toEqual('a&quot;b');
        });

        it('should return empty string for null/undefined', function () {
            expect(escapeHtml(null)).toEqual('');
            expect(escapeHtml(undefined)).toEqual('');
            expect(escapeHtml('')).toEqual('');
        });

        it('should escape multiple characters', function () {
            expect(escapeHtml('<script>alert("xss")</script>')).toEqual('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        });
    });

    // ===========================
    // setFilter
    // ===========================

    describe('#setFilter', function () {
        beforeEach(function () {
            config = createTestConfig();
        });

        it('should set currentFilter to all', function () {
            setFilter('all');
            expect(currentFilter).toEqual('all');
        });

        it('should set currentFilter to global', function () {
            setFilter('global');
            expect(currentFilter).toEqual('global');
        });

        it('should set currentFilter to group id', function () {
            setFilter('group_1');
            expect(currentFilter).toEqual('group_1');
        });
    });

    // ===========================
    // removeCookiesActionFromConfig (Chrome MV3)
    // ===========================

    describe('#removeCookiesActionFromConfig', function () {
        it('should remove cookie actions from config', function () {
            var cfg = createTestConfig();
            cfg.headers.push({ id: 'c1', action: 'cookie_add_or_modify', header_name: 'Cookie', header_value: 'a=1', group_id: null, url_contains: '', comment: '', apply_on: 'req', status: 'on' });
            cfg.headers.push({ id: 'c2', action: 'cookie_delete', header_name: 'Cookie', header_value: '', group_id: null, url_contains: '', comment: '', apply_on: 'req', status: 'on' });

            var result = removeCookiesActionFromConfig(cfg);
            expect(result.headers.length).toEqual(3);
            expect(result.headers.find(h => h.action === 'cookie_add_or_modify')).toBeUndefined();
            expect(result.headers.find(h => h.action === 'cookie_delete')).toBeUndefined();
        });
    });

    // ===========================
    // Integration: addNewRule -> saveData flow
    // ===========================

    describe('Integration: addNewRule persists to storage', function () {
        beforeEach(function () {
            config = createTestConfig();
            ruleIdCounter = 100;
            currentFilter = 'all';
            jasmine.clock().install();
        });

        afterEach(function () {
            jasmine.clock().uninstall();
        });

        it('should persist new rule to storage after addNewRule + scheduleAutoSave', function () {
            addNewRule();
            expect(config.headers.length).toEqual(4);

            jasmine.clock().tick(1000);

            var saved = JSON.parse(mockStorage.config);
            expect(saved.headers.length).toEqual(4);
            expect(saved.headers[3].id).toEqual('rule_100');
            expect(saved.headers[3].header_name).toEqual('');
            expect(saved.headers[3].status).toEqual('off');
        });

        it('should persist rule with group_id when added under group filter', function () {
            currentFilter = 'group_1';
            addNewRule();

            jasmine.clock().tick(1000);

            var saved = JSON.parse(mockStorage.config);
            var newRule = saved.headers.find(h => h.id === 'rule_100');
            expect(newRule).toBeDefined();
            expect(newRule.group_id).toEqual('group_1');
            expect(newRule.url_contains).toEqual('api');
        });
    });
});
