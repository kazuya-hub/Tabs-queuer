'use strict';
import * as configManager from "../modules/configManager.js";

console.log('configManager', configManager);


const settings_form = document.forms['setting-area'];

const heading = document.getElementById('heading');
const message = document.getElementById('message');
const save_button = document.getElementById('save-button');
const reset_button = document.getElementById('reset-button');
const link_to_sharing_config = document.getElementById('link-to-sharing-config');



/**
 * DOMから設定を取得する
 * @returns {Config}
 */
function getConfigFromDOM() {
    /** @type {Config} */
    const config_to_return = {};
    // configManager.INIT_CONFIGから全てのプロパティを取得し、値のデータ型を判定する
    Object.keys(configManager.INIT_CONFIG).forEach(config_key => {
        const property_type = typeof configManager.INIT_CONFIG[config_key];
        try {
            if (property_type === 'boolean') {
                config_to_return[config_key] = Boolean(settings_form[config_key].checked);
            } else if (property_type === 'number') {
                config_to_return[config_key] = parseInt(settings_form[config_key].value);
            } else if (property_type === 'string') {
                config_to_return[config_key] = String(settings_form[config_key].value);
            }
        } catch (error) {
            // 握りつぶす
        }
    });
    return config_to_return;
}

/**
 * ConfigをDOMにセットする
 * @param {Config} config 
 */
function setConfigToDOM(config) {
    // console.log('setConfigToDOM', config);
    // configManager.INIT_CONFIGから全てのプロパティを取得し、値のデータ型を判定する
    Object.keys(configManager.INIT_CONFIG).forEach(config_key => {
        const property_type = typeof configManager.INIT_CONFIG[config_key];
        try {
            if (property_type === 'boolean') {
                settings_form[config_key].checked = config[config_key];
            } else if (property_type === 'number') {
                settings_form[config_key].value = config[config_key];
            } else if (property_type === 'string') {
                settings_form[config_key].value = config[config_key];
            }
        } catch (error) {
            // 握りつぶす
        }
    });
}

function updateMessage(text) {
    message.value = text;
    message.value = message.value;
}

// URLのクエリに関する処理
const query_string = window.location.search.slice(1); // 最初の?を抜くためにslice
/**
 * @type {Array.<string>} `${key}=${value}` の配列
 */
const query_items = query_string.split('&');
const query_map = new Map(query_items.map(item => item.split('=')));
// console.log(query_map);


/**
 * カレントウィンドウのIDを取得する
 * @returns {Promise.<number>}
 */
function getCurrentWindowId() {
    return new Promise((resolve, reject) => {
        chrome.windows.getCurrent(window => {
            resolve(window.id);
        });
    });
}

(async () => {
    /**
     * - 対象がウィンドウ設定ならウィンドウID
     * - 対象がウィンドウ設定でないならchrome.windows.WINDOW_ID_NONE
     */
    const target_windowId =
        (query_map.get('target') === 'window') ?
            await getCurrentWindowId() :
            chrome.windows.WINDOW_ID_NONE;
    // console.log('config_target:', target_windowId);
    if (target_windowId === chrome.windows.WINDOW_ID_NONE) {
        heading.innerHTML = '<strong>共有設定</strong>';
        configManager.onSharingConfigUpdated(changes => {
            location.reload();
        });
    } else {
        heading.innerHTML = `<strong>このウィンドウ(ID:${target_windowId})</strong>の設定`;
        configManager.onWindowConfigUpdated((windowId, change) => {
            if (target_windowId === windowId) {
                location.reload();
            }
        });
        link_to_sharing_config.onclick = () => {
            chrome.runtime.openOptionsPage();
        };
        
        const options_page = chrome.runtime.getManifest().options_page;
        link_to_sharing_config.href = chrome.runtime.getURL(options_page);
        link_to_sharing_config.classList.add('showing');
    }

    /** 
     * 設定をロードする 
     * @returns {Promise<configManager.Config>}
     */
    function loadConfig() {
        if (target_windowId === chrome.windows.WINDOW_ID_NONE) {
            return configManager.loadSharingConfig();
        } else {
            return configManager.loadWindowConfig(target_windowId);
        }
    }
    /** 
     * 設定をセーブする 
     * @param {configManager.Config} config
     * 
     * @returns {Promise<Void>}
     */
    function saveConfig(config) {
        if (target_windowId === chrome.windows.WINDOW_ID_NONE) {
            return configManager.saveSharingConfig(config);
        } else {
            return configManager.saveWindowConfig(target_windowId, config);
        }
    }
    /** 
     * 設定を削除する 
     * @returns {Promise<Void>}
     * */
    function removeConfig() {
        if (target_windowId === chrome.windows.WINDOW_ID_NONE) {
            return configManager.removeSharingConfig();
        } else {
            return configManager.removeWindowConfig(target_windowId);
        }
    }

    const loaded_config = await loadConfig();
    setConfigToDOM(loaded_config);
    // 設定のDOMが変更された時のイベント
    settings_form.addEventListener('change', event => {
        const config = getConfigFromDOM();
        const verify_result = configManager.verifyConfig(config);
        updateMessage(verify_result.join('\n'));
        // configに問題があるならsave_buttonを無効化する
        if (verify_result.length > 0) {
            message.classList.add('warning');
            save_button.disabled = true;
        } else {
            message.classList.remove('warning');
            save_button.disabled = false;
        }
    });
    // セーブボタンがクリックされたらストレージに保存する
    save_button.onclick = async () => {
        const config = getConfigFromDOM();
        await saveConfig(config);
        // console.log('saved config:', config);
        updateMessage('保存しました');
    }
    // リセットボタン
    reset_button.onclick = async () => {
        if (confirm('本当にリセットしますか?')) {
            await removeConfig();
        }
    }
})();
