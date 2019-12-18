'use strict';
/* 設定の仕様
INIT_CONFIG:
    初期設定　読み取り専用
sharing_config:
    共有設定　設定ページで変更できる chrome.storage.local APIで保管する
    いずれchrome.storage.syncに移したい chrome.storage.sync APIの制限が課題になる
window_config:
    ウィンドウごとの設定　ポップアップで変更できる chrome.storage.local APIで保管する

設定のプロパティが欠けている場合は、次に優先度が高い設定の値を採用する
設定の優先度は 初期設定 < 共有設定 < ウィンドウ設定
*/

/* 設定の項目を増やす時の作業
1. htmファイルのフォーム内にユーザーの入力を受け付けるためのDOMを追加、jsで取得する為に使うname属性を付ける
2. このファイルの@typedef ConfigとINIT_CONFIGに項目を追加する
3. 必要ならverifyConfigに検証の処理を追加する
4. 既存のデータ型でないなら、configUI.jsのgetConfigFromDOMとsetConfigToDOMに処理を追加する
*/

/**
 * @typedef {Object} Config コンフィグのプロパティ名とconfigUI.htmlに配置するinput要素のname属性の値を同じにする
 * @property {number} [windowId] 設定を紐づけられたウィンドウのID ウィンドウの設定ならこのプロパティを持つ
 * 
 * @property {boolean} [upper_limit_available] タブ数の上限(自動格納)が有効か否か
 * @property {boolean} [lower_limit_available] タブ数の下限(自動展開)が有効か否か
 * @property {boolean} [ignore_duplicates] タブをキューに追加する時、キュー内でURLが重複する追加を無視するか否か
 * @property {boolean} [tab_closing_after_send] 右クリックメニューからタブをキューに送った時、タブを閉じるか否か
 * @property {boolean} [wait_for_tab_loading] タブの自動格納を行う時、対象のタブのローディングが完了するのを待つか否か
 * @property {boolean} [ignore_loading_tabs] タブの自動格納を行う時、対象のタブがロード中の場合は格納を中止するか否か
 * @property {boolean} [ignore_active_tabs] タブの自動格納を行う時、対象のタブがアクティブな場合は格納を中止するか否か
 * @property {number} [upper_limit_value] タブ数の上限(自動格納)
 * @property {number} [lower_limit_value] タブ数の下限(自動展開)
 * 
 * @property {string} [target_tab_to_auto_store] タブの自動格納をする時にタブをしまう順番
 *     - 'rightmost': 一番右のタブからしまう
 *     - 'latest': 最後に開いたタブをしまう
 * @property {string} [position_to_enqueue] タブをキューに追加する時の位置
 *     - 'top': キューの先頭
 *     - 'last': キューの最後尾
 * @property {string} [position_to_dequeue] タブをキューから取り出す時の位置
 *     - 'rightmost': 一番右
 *     - 'rightnext': アクティブなタブの右隣
 * @property {string} [position_to_auto_restore] タブを自動展開する時の位置
 *     - 'unset': position_to_dequeueと同じ
 *     - 'rightmost': 一番右
 *     - 'rightnext': アクティブなタブの右隣
 * @property {string} [queue_style_font_size] キューのスタイルのfont-sizeプロパティに設定する値
 */

/**
 * @type {Config} 初期設定 読み取り専用
 */
export const INIT_CONFIG = Object.freeze({
    upper_limit_available: true,
    lower_limit_available: true,
    ignore_duplicates: true,
    tab_closing_after_send: true,
    wait_for_tab_loading: true,
    ignore_loading_tabs: true,
    ignore_active_tabs: true,
    upper_limit_value: 10,
    lower_limit_value: 5,
    target_tab_to_auto_store: 'rightmost',
    position_to_enqueue: 'last',
    position_to_dequeue: 'rightnext',
    position_to_auto_restore: 'rightmost',
    queue_style_font_size: '12px'
});

/** chrome.storage API内でコンフィグを保存する為に使うキー */
export const CONFIG_TARGET = Object.freeze({
    /** chrome.storage.local API */
    LOCAL: {
        /** 共有設定 */
        SHARING_CONFIG: 'sharing_config',
        /** ウィンドウ設定 */
        WINDOW_CONFIGS: 'window_configs'
    },
    /** chrome.storage.sync API */
    SYNC: {
        /** 共有設定 */
        SHARING_CONFIG: 'sharing_config' // 共有設定はchrome.storage.sync APIで保管するようにする?
    }
});

/**
 * Configに問題が無いか検証する
 * @param {Config} config 
 * @returns {Array.<String>} warnings
 */
export function verifyConfig(config) {
    // console.log('verifyConfig', config);
    const warnings = [];

    if (
        (typeof config.upper_limit_value) !== 'number' ||
        Number.isNaN(config.upper_limit_value)
    ) {
        warnings.push('タブ数の上限が不正です');
    }

    if (
        (typeof config.lower_limit_value) !== 'number' ||
        Number.isNaN(config.lower_limit_value)
    ) {
        warnings.push('タブ数の下限が不正です');
    }

    if (config.upper_limit_available && config.lower_limit_available) {
        if (config.upper_limit_value < config.lower_limit_value) {
            // タブ数の上限と下限が有効になっていて、上限が下限より小さい場合
            warnings.push('タブ数の上限が下限より小さいため、保存できません');
        }
    }
    return warnings;
}


/**
 * findPropertiesに与えられた条件 **全てに** 合致する **最初の** 設定をconfigsの中から見つけて、
 *     configs内でのインデックスを返す
 * - 見つからなかった場合は-1を返す
 * @param {Array.<Config>} configs
 * @param {Object} findProperties
 *     @param {number} [findProperties.windowId]
 * 
 * @returns {number} index
 */
export function findIndexOfConfig(configs, findProperties) {
    const array_of_config = configs;
    const windowId = findProperties.windowId;
    // テスト用関数の配列
    const test_functions = [];
    if (windowId !== undefined) {
        test_functions.push(config => config.windowId === windowId);
    }
    // findIndex
    const found_index = array_of_config.findIndex(queue => {
        return test_functions.every(test => test(queue));
    });
    return found_index;
}

/**
 * findPropertiesに与えられた条件 **全てに** 合致する **最初の** 設定をconfigsの中から見つけて返す
 * - 見つからなかった場合はnullを返す
 * @param {Array.<Config>} configs
 * 
 * @param {Object} findProperties
 *     @param {number} [findProperties.windowId]
 * 
 * @returns {Config}
 */
export function findConfig(configs, findProperties) {
    const found_index = findIndexOfConfig(configs, findProperties);
    return configs[found_index] || null;
}

/**
 * ストレージから共有設定を取得する
 * @returns {Promise.<Config>}
 */
export function loadSharingConfig() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get({
            [CONFIG_TARGET.LOCAL.SHARING_CONFIG]: {}
        }, result => {
            const sharing_config = result[CONFIG_TARGET.LOCAL.SHARING_CONFIG];
            resolve(Object.assign(
                {},
                INIT_CONFIG,
                sharing_config
            ));
        });
    });
}

/**
 * ストレージからウィンドウの設定を取得する
 * - ウィンドウの設定がなかったり、そもそも存在しないウィンドウだった場合は共有設定が渡される
 * @param {Number} windowId 
 * @returns {Promise.<Config>}
 */
export function loadWindowConfig(windowId) {
    return new Promise(async (outerResolve, outerReject) => {
        const sharing_config = await loadSharingConfig();
        const window_configs = await new Promise((innerResolve, innerReject) => {
            chrome.storage.local.get({
                [CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]: []
            }, result => {
                innerResolve(result[CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]);
            });
        });
        const window_config = findConfig(window_configs, {
            windowId: windowId
        });
        return outerResolve(Object.assign(
            {},
            sharing_config,
            window_config
        ));
    });
}


/**
 * ストレージに共有設定を保存する
 * @param {Config} config 
 * @returns {Promise.<Void>}
 */
export function saveSharingConfig(config) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({
            [CONFIG_TARGET.LOCAL.SHARING_CONFIG]: config
        }, () => {
            resolve();
        });
    });
}

/**
 * ストレージにウィンドウの設定を保存する
 * @param {Number} windowId 
 * @param {Config} config 
 * @return {Promise.<Void>}
 */
export function saveWindowConfig(windowId, config) {
    return new Promise(async (outerResolve, outerReject) => {
        /** @type {Array.<Config>} */
        const window_configs = await new Promise((innerResolve, innerReject) => {
            chrome.storage.local.get({
                [CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]: []
            }, result => {
                innerResolve(result[CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]);
            });
        });
        const old_window_config_index = findIndexOfConfig(window_configs, {
            windowId: windowId
        });
        if (old_window_config_index !== -1) {
            window_configs.splice(old_window_config_index, 1);
        }

        const window_config = Object.assign(
            {},
            config,
            {
                windowId: windowId
            }
        );
        window_configs.push(
            window_config
        );
        chrome.storage.local.set({
            [CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]: window_configs
        }, () => {
            outerResolve();
        });
    });
}

/**
 * ストレージから共有設定を削除する 次に共有設定が保存されるまでは初期設定が代わりに使われるようになる
 * @returns {Promise.<Void>}
 */
export function removeSharingConfig() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({
            [CONFIG_TARGET.LOCAL.SHARING_CONFIG]: {}
        }, () => {
            resolve();
        });
    });
}

/**
 * ストレージからウィンドウ設定を削除する
 * @param {number} windowId 
 * 
 * @returns {Promise.<Void>}
 */
export function removeWindowConfig(windowId) {
    return new Promise(async (outerResolve, outerReject) => {
        /** @type {Array.<Config>} */
        const window_configs = await new Promise((innerResolve, innerReject) => {
            chrome.storage.local.get({
                [CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]: []
            }, result => {
                innerResolve(result[CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]);
            });
        });
        const target_config_index = findIndexOfConfig(window_configs, {
            windowId: windowId
        });
        if (target_config_index === -1) {
            return outerResolve();
        }

        window_configs.splice(target_config_index, 1);
        chrome.storage.local.set({
            [CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]: window_configs
        }, () => {
            outerResolve();
        });
    });
}


/**
 * ストレージから全てのウィンドウ設定を削除する
 * @returns {Promise.<Void>}
 */
export function clearWindowConfigs() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({
            [CONFIG_TARGET.LOCAL.WINDOW_CONFIGS]: []
        }, () => {
            resolve();
        });
    });
}

/**
 * ストレージから全ての設定を削除する(初期設定だけが残る)
 * @returns {Promise.<Void>}
 */
export function initConfig() {
    return Promise.all([
        removeSharingConfig(),
        clearWindowConfigs()
    ]);
}


/**
 * @typedef {Object} SharingConfigUpdate
 * @property {Config} oldValue
 * @property {Config} newValue
 */

/**
 * @callback SharingConfigUpdateCallback
 * @param {SharingConfigUpdate} changes
 */

/**
 * 共有設定が更新された時のイベント
 * @param {SharingConfigUpdateCallback} callback
 */
export function onSharingConfigUpdated(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        const sharing_config_changes = changes[CONFIG_TARGET.LOCAL.SHARING_CONFIG];
        if (sharing_config_changes) {
            callback(sharing_config_changes);
        }
    });
}

/**
 * @typedef {Object} WindowConfigsAreaUpdate
 * @property {Array.<Config>} oldValue
 * @property {Array.<Config>} newValue
 */

/**
 * @callback WidnowConfigsAreaUpdateCallback
 * @param {WindowConfigsAreaUpdate} changes
 */

/**
 * ストレージ上のウィンドウの設定の領域が更新された時のイベント
 * @param {WidnowConfigsAreaUpdateCallback} callback
 */
export function onWindowConfigsAreaUpdated(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        const window_configs_changes = changes[CONFIG_TARGET.LOCAL.WINDOW_CONFIGS];
        if (window_configs_changes) {
            callback(window_configs_changes);
        }
    });
}

function objectSort(object) {
    /**
     * ソートされたキーの配列
     */
    const keys = Object.keys(object).sort();
    const map = {};
    keys.forEach(key => {
        const value = object[key];
        if ((typeof value) === "object") {
            map[key] = objectSort(value);
        } else {
            map[key] = value;
        }
    });
    return map;
}

function deepEqual(obj1, obj2) {
    const obj1Str = JSON.stringify(objectSort(obj1));
    const obj2Str = JSON.stringify(objectSort(obj2));
    return obj1Str === obj2Str;
}

/**
 * @typedef {Object} WindowConfigUpdate
 * @property {Config} oldValue
 * @property {Config} newValue
 */

/**
 * @callback WidnowConfigUpdateCallback
 * @param {number} windowId
 * @param {WindowConfigUpdate} change
 */

/**
 * ウィンドウのキューが更新された時のイベント
 * @param {WidnowConfigUpdateCallback} callback 
 */
export function onWindowConfigUpdated(callback) {
    onWindowConfigsAreaUpdated(changes => {
        /** @type {Array.<Config>} */
        const oldValue = changes.oldValue || new Array();
        /** @type {Array.<Config>} */
        const newValue = changes.newValue || new Array();
        const oldValue_windowId_list = oldValue.map(config => config.windowId);
        const newValue_windowId_list = newValue.map(config => config.windowId);
        /**
         * oldValueかnewValueのどちらかに存在した全てのウィンドウ設定のウィンドウIDのセット
         * @type {Set.<number>}
         */
        const all_windowId_list = new Set(
            oldValue_windowId_list.concat(newValue_windowId_list)
        );
        all_windowId_list.forEach(windowId => {
            const found_older = findConfig(oldValue, {
                windowId: windowId
            });
            const found_newer = findConfig(newValue, {
                windowId: windowId
            });
            const older_window_config = found_older || {};
            const newer_window_queue = found_newer || {};
            if (deepEqual(older_window_config, newer_window_queue) === false) {
                callback(windowId, {
                    oldValue: older_window_config,
                    newValue: newer_window_queue
                });
            }
        });
    });
}
