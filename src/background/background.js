'use strict';

/*
chrome.runtime.onInstalledなどのリスナーを同期的に登録しないと
chrome様が適切にbackground.jsを呼び出してくれないので、
非同期のimport()はbackground.jsでは使えない
*/
import * as chrome_API_document from '../modules/chrome_API_document.js';
import * as queuesManager from '../modules/queuesManager.js';
import * as configManager from '../modules/configManager.js';
console.log('queuesManager', queuesManager);
console.log('configManager', configManager);


/** 
 * ブラウザアクションのバッジに表示するキューのアイテム数の表示上限
 */
const QUEUE_ITEMS_DISPLAY_UPPER_LIMIT = 999;

/**
 * タブにバッジをセットする
 * @param {number} tabId
 * @param {Object} setProperties 
 *     @param {String} [setProperties.text] 指定されなかった場合はセットしない
 *     @param {String | Array.<number>} [setProperties.color] カラーコードの文字列か[r, g, b, a] 指定されなかった場合はセットしない
 *     @param {boolean} [setProperties.check_for_tab_exists] trueなら、バッジをセットする前にタブが存在するか確認する デフォルトはtrue
 * 
 * @returns {Promise.<void>} 処理が終了したらresolveされるPromise
 */
function setBadgeToTab(tabId, setProperties) {
    return new Promise(async (outerResolve, outerReject) => {
        const target_tab_id = tabId;
        const default_properties = {
            check_for_tab_exists: true
        };
        const complete_properties = Object.assign({}, default_properties, setProperties);
        const check_for_tab_exists = complete_properties.check_for_tab_exists;
        const text_to_set = complete_properties.text;
        const color_to_set = complete_properties.color;

        if (check_for_tab_exists === true) {
            const target_tab_is_exist = await new Promise((innerResolve, innerReject) => {
                chrome.tabs.query({}, all_tabs => {
                    const result = all_tabs.some(tab => tab.id === target_tab_id);
                    innerResolve(result);
                });
            });
            if (target_tab_is_exist === false) {
                return outerResolve();
            }
        }

        if (color_to_set !== undefined) {
            await new Promise((innerResolve, innerReject) => {
                chrome.browserAction.setBadgeBackgroundColor({
                    color: color_to_set,
                    tabId: target_tab_id
                }, () => {
                    innerResolve();
                });
            });
        }
        if (text_to_set !== undefined) {
            await new Promise((innerResolve, innerReject) => {
                chrome.browserAction.setBadgeText({
                    text: text_to_set,
                    tabId: target_tab_id
                }, () => {
                    innerResolve();
                });
            });
        }

        return outerResolve();
    });
}

/**
 * 数に応じてバッジの色を決める
 * @param {number} number 
 * 
 * @returns {string} カラーコード
 */
function badgeColor(number) {
    if (number === 0) {
        return '#808080';
    }

    if ((1 <= number) && (number <= 19)) return '#0080FF';
    if ((20 <= number) && (number <= 99)) return '#FF8000';

    return '#FF0000';
}

/**
 * キューのアイテムの個数を示す数をタブのバッジにセットする
 * @param {number} tabId
 * @param {number} number_to_set 
 * 
 * @returns {Promise.<void>} 処理が終了したらresolveされるPromise
 */
function setQueueItemsCountToTab(tabId, number_to_set) {
    return new Promise(async (outerResolve, outerReject) => {
        const badge_text =
            (number_to_set <= QUEUE_ITEMS_DISPLAY_UPPER_LIMIT) ?
                `${number_to_set}` :
                `${QUEUE_ITEMS_DISPLAY_UPPER_LIMIT}+`;
        const badge_color = badgeColor(number_to_set);
        await setBadgeToTab(tabId, {
            text: badge_text,
            color: badge_color
        });
        return outerResolve();
    });
}

/**
 * 
 * @param {chrome_API_document.Window} window 
 * @param {number} number_to_set 
 */
function setQueueItemsCountToWindow(window, number_to_set) {
    return new Promise((outerResolve, outerReject) => {
        window.tabs.forEach(async (tab) => {
            await setQueueItemsCountToTab(tab.id, number_to_set);
        });
        return outerResolve();
    });
}



/**
 * タブのロードが完了するまで待つ
 * @param {number} target_tab_id
 * 
 * @returns {Promise.<Tab>} ロードが完了したタブをresolveするpromise
 */
function waitForTabLoading(target_tab_id) {
    return new Promise(async (outerResolve, outerReject) => {

        /**
         * ロードを待っているタブを取得する
         * @returns {Promise.<chrome_API_document.Tab | void>} タブが存在しなかった場合はundefinedをresolveする
         */
        function getTargetTab() {
            return new Promise((innerResolve, innerReject) => {
                /*
                タブが存在しない場合にも対応するため、chrome.tabs.getではなくchrome.tabs.queryを使う
                タブが存在しなかった場合はundefinedをresolveする
                 */
                chrome.tabs.query({}, all_tabs => {
                    const found_target_tab = all_tabs.find(tab => {
                        return (tab.id === target_tab_id);
                    });
                    innerResolve(found_target_tab);
                });
            });
        }

        const current_target_tab = await getTargetTab();
        if (current_target_tab.status === 'complete') {
            return outerResolve(current_target_tab);
        }

        chrome.tabs.onUpdated.addListener((updated_tab_id, changeInfo, updated_tab) => {
            if ((updated_tab_id === target_tab_id) && (updated_tab.status === 'complete')) {
                return outerResolve(updated_tab);;
            }
        });

        setTimeout(async () => {
            const finally_target_tab = await getTargetTab();
            return outerResolve(finally_target_tab);
        }, 15000);
    });
}

/**
 * タブをキューに送る
 * @param {Object} tab
 * @param {Object} [sendProperties]
 *     @param {boolean} [sendProperties.tab_closing_after_send] タブをキューに送った後、タブを閉じるか否か
 *     trueが渡された場合、タブのロードが完了するのを待ってから改めてタブの情報を取得する
 * 
 * @returns {Promise} 処理が終了した時にresolveされるpromise
 */
function sendTabToWindowQueue(tab, sendProperties) {
    // console.log('sendTabToWindowQueue', tab, sendProperties);
    return new Promise(async (outerResolve, outerReject) => {
        const tab_to_send = tab;
        const windowId = tab_to_send.windowId;
        const tab_closing_after_send = sendProperties && sendProperties.tab_closing_after_send;

        /**
         * タブを閉じる
         * @returns {Promise.<void>} タブの削除が完了した時にresolveされるpromise
         */
        function closeTab() {
            const target_tab_id = tab_to_send.id;
            return new Promise((innerResolve, innerReject) => {
                chrome.tabs.onRemoved.addListener((removed_tab_id, removeInfo) => {
                    if (removed_tab_id === target_tab_id) {
                        innerResolve();
                    }
                });
                chrome.tabs.remove(target_tab_id);
            });
        }

        const items = [
            queuesManager.buildQueueItem({
                title: tab_to_send.title,
                url: tab_to_send.url,
                favIconUrl: tab_to_send.favIconUrl
            })
        ];
        await queuesManager.pushItemsToWindowQueue(windowId, items);
        if (tab_closing_after_send === true) {
            await closeTab();
            // console.log('sendTabToWindowQueue tab closed');
        }
        return outerResolve();
    });
}

/**
 * タブの配列をインデックスで昇順にソートして返す
 * @param {Array.<chrome_API_document.Tab>} tabs 
 * 
 * @returns {Array.<chrome_API_document.Tab>}
 */
function sortTabsByIndex(tabs) {
    const tabs_sorted_by_index = tabs.sort((tab1, tab2) => {
        if (tab1.index < tab2.index) {
            return -1;
        }
        else if (tab1.index > tab2.index) {
            return 1;
        }
        else {
            return 0;
        }
    });
    return tabs_sorted_by_index;
}

/**
 * タブの配列をIDで昇順にソートして返す
 * @param {Array.<chrome_API_document.Tab>} tabs 
 * 
 * @returns {Array.<chrome_API_document.Tab>}
 */
function sortTabsById(tabs) {
    const tabs_sorted_by_id = tabs.sort((tab1, tab2) => {
        if (tab1.id < tab2.id) {
            return -1;
        }
        else if (tab1.id > tab2.id) {
            return 1;
        }
        else {
            return 0;
        }
    });
    return tabs_sorted_by_id;
}

/**
 * @event ウィンドウ内のタブが増えた時のイベント
 * @param {Object} event
 *     @param {chrome_API_document.Tab} event.tab 追加されたタブ
 */
function onTabsIncreased(event) {
    const added_tab = event.tab;
    if (added_tab === undefined) return;
    const windowId = added_tab.windowId;
    if (windowId === undefined) return;
    // console.log('onTabsIncreased', { windowId });
}

/**
 * @event ウィンドウ内のタブが減った時のイベント
 * @param {Object} event 
 *     @param {number} windowId イベントが発生したウィンドウのID
 */
function onTabsDecreased(event) {
    const windowId = event.windowId;
    // console.log('onTabsDecreased', { windowId });
}

/**
 * ウィンドウの設定をロードして、条件に合う場合はタブの自動格納をする 
 * @param {number} windowId 
 * 
 * @returns {Promise.<void>} 処理が終了した時にresolveされるPromise
 */
function automaticTabStore(windowId) {
    return queuesManager.requestTransaction(() => {
        // console.log('automaticTabStore', windowId);
        return new Promise(async (outerResolve, outerReject) => {
            const window_config = await configManager.loadWindowConfig(windowId);
            const upper_limit_available = window_config.upper_limit_available;
            const upper_limit_value = window_config.upper_limit_value;
            const target_tab_to_auto_store = window_config.target_tab_to_auto_store;
            const ignore_loading_tabs = window_config.ignore_loading_tabs;
            const ignore_active_tabs = window_config.ignore_active_tabs;
            if (upper_limit_available === false) {
                return outerResolve();
            }

            const target_window = await new Promise((innerResolve, innerReject) => {
                chrome.windows.get(windowId, {
                    populate: true
                }, result => {
                    innerResolve(result);
                });
            });
            const number_of_tabs = target_window.tabs.length;
            if (number_of_tabs <= upper_limit_value) {
                return outerResolve();
            }

            /**
             * タブをキューに送る
             *   - chrome固有のタブは無視する
             *   - 設定が有効になっていれば、ロード中のタブを無視する
             *   - 設定が有効になっていれば、アクティブなタブを無視する
             * @param {Object} tab 
             * 
             * @returns {Promise.<void>} 処理が終了した時にresolveされるpromise タブを送らなかった場合もresolveされる
             */
            function tryToSendTab(tab) {
                // console.log('tryToSendTab', tab.id);
                return new Promise(async (innerResolve, innerReject) => {
                    if ((ignore_loading_tabs === true) && (tab.status === 'loading')) {
                        return innerResolve();
                    }

                    if (tab.url.startsWith('chrome')) {
                        // chrome固有のタブは無視する
                        return innerResolve();
                    }
                    if ((ignore_active_tabs === true) && (tab.active === true)) {
                        return innerResolve();
                    }

                    await sendTabToWindowQueue(tab, {
                        tab_closing_after_send: true
                    });
                    return innerResolve();
                });
            }

            if (target_tab_to_auto_store === 'latest') {
                const tabs_sorted_by_id = sortTabsById(target_window.tabs);
                const latest_created_tab = tabs_sorted_by_id[tabs_sorted_by_id.length - 1];
                await tryToSendTab(latest_created_tab);
            }
            if (target_tab_to_auto_store === 'rightmost') {
                const tabs_sorted_by_index = sortTabsByIndex(target_window.tabs);
                const rightmost_tab = tabs_sorted_by_index[tabs_sorted_by_index.length - 1];
                await tryToSendTab(rightmost_tab);
            }
            return outerResolve();
        });
    });
}

/**
 * ウィンドウの設定をロードして、条件に合う場合はタブの自動展開をする 
 * @param {number} windowId 
 * 
 * @returns {Promise.<void>} 処理が終了した時にresolveされるPromise
 */
function automaticTabRestore(windowId) {
    return queuesManager.requestTransaction(() => {
        // console.log('automaticTabRestore', windowId);
        return new Promise(async (outerResolve, outerReject) => {
            const window_config = await configManager.loadWindowConfig(windowId);
            const lower_limit_available = window_config.lower_limit_available;
            const lower_limit_value = window_config.lower_limit_value;
            const position_to_dequeue =
                (window_config.position_to_auto_restore === 'unset') ?
                    window_config.position_to_dequeue :
                    window_config.position_to_auto_restore;
            if (lower_limit_available === false) {
                return outerResolve();
            }

            // 存在しないウィンドウを取得しようとするとエラーが発生してしまうので、getAllを使う
            const all_windows = await new Promise((innerResolve, innerReject) => {
                chrome.windows.getAll({
                    populate: true
                }, result => {
                    innerResolve(result);
                });
            });
            const target_window = all_windows.find(window => window.id === windowId);
            if (target_window === undefined) {
                return outerResolve(); // 対象のウィンドウがない
            }
            if (target_window.tabs.length >= lower_limit_value) {
                return outerResolve(); // ウィンドウ内のタブ数が下限を下回っていない
            }
            const target_window_queue = await queuesManager.getWindowQueue(windowId);
            const target_item_index =
                target_window_queue.items.findIndex(item => {
                    return (item.locked !== true);
                });
            if (target_item_index === -1) {
                return outerResolve(); // ロックされていないアイテムが無い
            }
            await queuesManager.dequeueFromWindowQueue(windowId, {
                index: target_item_index,
                active: false,
                position: position_to_dequeue
            });
            return outerResolve();
        });
    });
}

/**
 * 全てのタブのバッジを更新する
 * @returns {Promise.<void>} 処理が完了したらresolveされるPromise
 */
function initialQueueItemsCount() {
    return new Promise(async (outerResolve, outerReject) => {
        const all_windows = await new Promise((innerResolve, innerReject) => {
            chrome.windows.getAll({
                populate: true
            }, result => {
                innerResolve(result);
            });
        });
        const all_window_queues = await queuesManager.getAllWindowQueues();

        all_windows.forEach(async window => {
            const target_window_queue =
                queuesManager.findQueue(all_window_queues, {
                    windowId: window.id
                });
            const number_of_queue_items =
                (target_window_queue === null) ?
                    0 :
                    target_window_queue.items.length;
            await setQueueItemsCountToWindow(window, number_of_queue_items);
        });
        return outerResolve();
    });
}

//インストール時の処理
chrome.runtime.onInstalled.addListener(details => {
    if (details.reason !== 'chrome_update') {
        // コンテキストメニューを作る
        chrome.contextMenus.create({
            'id': 'sendCurrentTabToQueue',
            'title': 'タブをキューに送る',
            'contexts': ['all']
        });
        chrome.contextMenus.create({
            'id': 'sendLinkToQueue',
            'title': 'リンク先をキューに送る',
            'contexts': ['link']
        });
        chrome.contextMenus.create({
            'id': 'sendCurrentWindowToQueue',
            'title': 'ウィンドウをキューに送る',
            'contexts': ['browser_action']
        });
    }
    // バッジの初期化
    queuesManager.requestTransaction(() => {
        return initialQueueItemsCount();
    });
});

//コンテキストメニューのリスナー
chrome.contextMenus.onClicked.addListener((info, tab) => {
    const contextId = info.menuItemId;
    const windowId = tab.windowId;
    if (contextId === 'sendCurrentTabToQueue') {
        queuesManager.requestTransaction(() => {
            return new Promise(async (outerResolve, outerReject) => {
                const window_config = await configManager.loadWindowConfig(windowId);
                const tab_closing_after_send = window_config.tab_closing_after_send;
                await sendTabToWindowQueue(tab, {
                    tab_closing_after_send
                });
                return outerResolve();
            });
        });
    }
    if (contextId === 'sendLinkToQueue') {
        const items = [
            queuesManager.buildQueueItem({
                url: info.linkUrl,
                title: info.selectionText
            })
        ];
        queuesManager.requestTransaction(() => {
            return queuesManager.pushItemsToWindowQueue(tab.windowId, items);
        });
    }
    if (contextId === 'sendCurrentWindowToQueue') {
        queuesManager.requestTransaction(() => {
            return new Promise(async (outerResolve, outerReject) => {
                const window = await new Promise((innerResolve, innerReject) => {
                    chrome.windows.get(windowId, {
                        populate: true
                    }, result => {
                        innerResolve(result);
                    });
                });
                const items = window.tabs.map(tab => {
                    const queue_item = queuesManager.buildQueueItem({
                        title: tab.title,
                        url: tab.url,
                        favIconUrl: tab.favIconUrl
                    });
                    return queue_item;
                });
                await queuesManager.pushItemsToWindowQueue(windowId, items);
                chrome.windows.onRemoved.addListener(removed_window_id => {
                    if (removed_window_id === windowId) {
                        return outerResolve();
                    }
                });
                chrome.windows.remove(windowId);
            });
        });
    }
});

// 多分chromeの起動時のイベント
chrome.runtime.onStartup.addListener(() => {
    configManager.clearWindowConfigs();
    queuesManager.requestTransaction(() => {
        return queuesManager.sendAllWindowQueuesToSavedQueues();
    });
    // バッジの初期化
    queuesManager.requestTransaction(() => {
        return initialQueueItemsCount();
    });
});

// ウィンドウが閉じられた時のイベント
chrome.windows.onRemoved.addListener(windowId => {
    // console.log('window onRemoved', windowId);
    configManager.removeWindowConfig(windowId);
    queuesManager.requestTransaction(() => {
        return queuesManager.sendWindowQueueToSavedQueues(windowId);
    });
});

/**
 * @param {chrome_API_document.Tab} tab 
 * 
 * @returns {Promise.<void>} 処理が終了したらresolveされるPromise
 */
function updateQueueItemsCount(tab) {
    const target_window_id = tab.windowId;
    const target_tab_id = tab.id;
    return new Promise(async (outerResolve, outerReject) => {
        const target_window_queue = await queuesManager.getWindowQueue(target_window_id);
        const number_to_set = target_window_queue.items.length;
        await setQueueItemsCountToTab(target_tab_id, number_to_set);
        return outerResolve();
    });
}

chrome.tabs.onCreated.addListener(async tab => {
    // console.log('tabs created', tab);
    const windowId = tab.windowId;
    onTabsIncreased({
        tab
    });
    await automaticTabStore(windowId);
    await queuesManager.requestTransaction(() => {
        return updateQueueItemsCount(tab);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // タブが新しいページを読み込むとポップアップアイコンのバッジが消えてしまうので、再設定する必要がある
    if (changeInfo.status === 'loading') {
        // console.log('chrome.tabs.onUpdated', tabId, changeInfo, tab);
        queuesManager.requestTransaction(() => {
            return updateQueueItemsCount(tab);
        });
    }
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    const target_tab_id = tabId;
    const target_window_id = attachInfo.newWindowId;
    queuesManager.requestTransaction(() => {
        return new Promise(async (outerResolve, outerReject) => {
            const target_window_queue = await queuesManager.getWindowQueue(target_window_id);
            const number_of_queue_items = target_window_queue.items.length;
            await setQueueItemsCountToTab(target_tab_id, number_of_queue_items);
            return outerResolve();
        });
    });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (removeInfo.isWindowClosing) {
        return; // ウィンドウが閉じられたことでタブも閉じられた場合は対応しない
    }
    // console.log('tabs removed', { tabId, removeInfo });
    const windowId = removeInfo.windowId;
    onTabsDecreased({
        windowId: windowId
    });
    automaticTabRestore(windowId);
});



queuesManager.onWindowQueueUpdated((windowId, change) => {
    // console.log('onWindowQueueUpdated', windowId, change);
    const newer_window_queue = change.newValue;
    const target_windowId = windowId;
    const number_of_queue_items = newer_window_queue.items.length;
    queuesManager.requestTransaction(() => {
        return new Promise(async (outerResolve, outerReject) => {
            const all_windows = await new Promise((innerResolve, innerReject) => {
                chrome.windows.getAll({
                    populate: true
                }, result => {
                    innerResolve(result);
                });
            });
            const target_window = all_windows.find(window => window.id === target_windowId);
            if (target_window === undefined) {
                return outerResolve();
            }
            await setQueueItemsCountToWindow(target_window, number_of_queue_items);
            return outerResolve();
        });
    });
});

