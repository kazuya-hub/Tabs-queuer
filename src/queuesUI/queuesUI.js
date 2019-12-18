'use strict';
import * as queuesManager from "../modules/queuesManager.js";
import * as configManager from "../modules/configManager.js";
console.log('queuesManager.js', queuesManager);

/**
 * ファビコンが存在しない場合、代わりに表示する画像
 */
const FAVICON_SRC_NOT_EXIST = './icons/favicon_not_exist.png';

/**
 * キューのアイテム数の表示の上限
 */
const ITEMS_COUNT_DISPLAY_UPPER_LIMIT = 999;

/**
 * @param {number} number 
 */
function queueItemsCountFormat(number) {
    if (number <= ITEMS_COUNT_DISPLAY_UPPER_LIMIT) {
        return `${number} items`;
    } else {
        return `${ITEMS_COUNT_DISPLAY_UPPER_LIMIT}+ items`;
    }
}


const queue_font_size_style = document.getElementById('queue-font-size-style');

const all_saved_queues_area = document.getElementById('all-saved-queues-area');
const all_window_queues_area = document.getElementById('all-window-queues-area');
const current_window_queue_area = document.getElementById('current-window-queue-area');

const saved_queues_list_container = document.getElementById('saved-queues-list-container');
const window_queues_list_container = document.getElementById('window-queues-list-container');
const current_window_queue_items_list_container = document.getElementById('current-window-queue-items-list-container');


const save_button = document.getElementById('save-button');
const clear_button = document.getElementById('clear-button');
const link_to_window_queues_list = document.getElementById('link-to-window-queues-list');

link_to_window_queues_list.href = chrome.runtime.getURL('queuesUI/queuesUI.html?content=window-queues');
link_to_window_queues_list.classList.add('showing');


const templates = document.getElementById('templates');
const queue_DOM_template =
    templates.querySelector('#queues-list-item-template').firstElementChild;
const queue_item_DOM_template =
    templates.querySelector('#queue-item-list-template').firstElementChild;
const saved_queue_dropdown_menu_content_template =
    templates.querySelector('#saved-queue-dropdown-menu-content-template').firstElementChild;
const window_queue_dropdown_menu_content_template =
    templates.querySelector('#window-queue-dropdown-menu-content-template').firstElementChild;


/**
 * @param {queuesManager.WindowQueue | queuesManager.SavedQueue} queue 
 */
function generateQueueDOM(queue) {
    console.log('generateQueueDOM', queue)
    const queue_DOM = queue_DOM_template.cloneNode(true);
    const lock_icon_DOM = queue_DOM.querySelector('.lock_icon');
    const queue_label_DOM = queue_DOM.querySelector('.queue-label');
    const items_count_DOM = queue_DOM.querySelector('.items-count');
    const favicons_area_DOM = queue_DOM.querySelector('.favicons-area');
    // .locked
    if (queue.locked === true) {
        lock_icon_DOM.classList.add('locked');
    }
    // .queue-label
    if (queue.key !== undefined) {
        // 保存されたキュー
        queue_label_DOM.innerText = queue.name || queue.key;
    } else {
        // ウィンドウのキュー
        queue_label_DOM.innerText = `windowId: ${queue.windowId}`;
    }
    items_count_DOM.innerText = queueItemsCountFormat(queue.items.length);
    items_count_DOM.setAttribute('title', `${queue.items.length} items`);
    queue.items.slice(0).forEach(queue_item => {
        const favicon_url = queue_item.favIconUrl;
        const favicon = document.createElement('img');
        favicon.classList.add('favicon');
        favicon.src = favicon_url || FAVICON_SRC_NOT_EXIST;
        favicon.setAttribute('title', queue_item.title || queue_item.url || '');
        favicons_area_DOM.appendChild(favicon);
    });
    return queue_DOM;
}

/**
 * @param {queuesManager.QueueItem} queue_item 
 */
function generateQueueItemDOM(queue_item) {
    const queue_item_DOM = queue_item_DOM_template.cloneNode(true);
    const lock_icon_DOM = queue_item_DOM.querySelector('.lock_icon');
    const favicon_DOM = queue_item_DOM.querySelector('.favicon');
    const title_DOM = queue_item_DOM.querySelector('.title');
    // .locked
    if (queue_item.locked === true) {
        lock_icon_DOM.classList.add('locked');
    }
    favicon_DOM.src = queue_item.favIconUrl || FAVICON_SRC_NOT_EXIST;
    title_DOM.innerText = queue_item.title || queue_item.url;
    return queue_item_DOM;
}


/**
 * 全てのドロップダウンメニューを閉じる
 */
function closeAllDropdownMenus() {
    document.querySelectorAll('.dropdown-menu-content.showing').forEach(showing_dropdown_menu_root => {
        showing_dropdown_menu_root.classList.remove('showing');
    });
    document.querySelectorAll('.dropdown-menu-item.selected').forEach(selected_dropdown_menu_item => {
        selected_dropdown_menu_item.classList.remove('selected');
    });
}

document.addEventListener('click', event => {
    if (event.target.classList.contains('dropdown-menu-button')) {
        // ドロップダウンメニューのアイコンがクリックされた時
        const dropdown_menu_button = event.target;
        const target_dropdown_menu_root = dropdown_menu_button.closest('.dropdown-menu-root');
        const target_dropdown_menu_content = target_dropdown_menu_root.querySelector('.dropdown-menu-content');
        if (target_dropdown_menu_content.classList.contains('showing') === true) {
            closeAllDropdownMenus();
        } else {
            closeAllDropdownMenus();
            const rect = dropdown_menu_button.getBoundingClientRect();
            target_dropdown_menu_content.style.top = `${rect.bottom + 10}px`;
            target_dropdown_menu_content.style.right = `${
                document.documentElement.clientWidth - rect.right}px`;
            target_dropdown_menu_content.classList.add('showing');
        }
    } else if (event.target.classList.contains('dropdown-menu-item')) {
        // ドロップダウンメニューのアイテムがクリックされた時
        const dropdown_menu_item = event.target;
        // クリックされたアイテムと同じ親を持つ、クリックされたアイテム以外の.dropdown-menu-itemの.selectedを削除する
        Array.from(dropdown_menu_item.parentNode.children).forEach(node => {
            if (node.classList.contains('dropdown-menu-item') === true) {
                if (node === dropdown_menu_item) {
                    return;
                }
                node.classList.remove('selected');
            }
        });
        // アイテムを選択する/解除する
        dropdown_menu_item.classList.toggle('selected');
    } else {
        const closest_dropdown_menu_root = event.target.closest('.dropdown-menu-root');
        if (closest_dropdown_menu_root === null) {
            // クリックされたノードがメニューの下にない場合、メニューを閉じる
            closeAllDropdownMenus();
        }
    }
});

(async () => {

    const current_window = await new Promise((resolve, reject) => {
        chrome.windows.getCurrent({
            populate: true
        }, result => {
            resolve(result);
        });
    });
    const current_window_id = current_window.id;

    const current_tab = current_window.tabs.find(tab => tab.active);
    const current_tab_id = current_tab.id;

    const current_window_config = await configManager.loadWindowConfig(current_window_id);
    const queue_font_size = current_window_config.queue_style_font_size;
    queue_font_size_style.innerHTML = `
    .queue,
    .queue-item {
        font-size: ${queue_font_size};
    }`;

    function updateAllSavedQueuesList() {
        return queuesManager.requestTransaction(() => {
            return queuesManager.getAllSavedQueues().then(all_saved_queues => {
                const fragment = document.createDocumentFragment();
                all_saved_queues.forEach(saved_queue => {
                    const saved_queue_DOM = generateQueueDOM(saved_queue);
                    saved_queue_DOM.classList.add('saved-queue');
                    fragment.appendChild(saved_queue_DOM);
                    const lock_icon_DOM = saved_queue_DOM.querySelector('.lock_icon');
                    const queue_info_DOM = saved_queue_DOM.querySelector('.queue-info');
                    const dropdown_menu_root = saved_queue_DOM.querySelector('.dropdown-menu-root');
                    const dropdown_menu_content = saved_queue_dropdown_menu_content_template.cloneNode(true);
                    dropdown_menu_root.appendChild(dropdown_menu_content);

                    const delete_queue_after_deploy = saved_queue.locked ? false : true;
                    function deploy() {
                        return queuesManager.requestTransaction(() => {
                            return queuesManager.deploySavedQueueToWindowQueue(
                                saved_queue.key, current_window_id,
                                {
                                    delete: delete_queue_after_deploy
                                }
                            );
                        });
                    }

                    function rename() {
                        const current_name = saved_queue.name;
                        const new_name = window.prompt('キューの新しい名前を入力してください', current_name);
                        if (new_name === null) {
                            return;
                        }
                        queuesManager.requestTransaction(() => {
                            return queuesManager.renameSavedQueue(saved_queue.key, new_name);
                        });
                    }

                    lock_icon_DOM.addEventListener('click', event => {
                        const locked = !lock_icon_DOM.classList.contains('locked'); // 反転する
                        queuesManager.requestTransaction(() => {
                            return queuesManager.setPropertiesToSavedQueue(
                                saved_queue.key, {
                                locked: locked
                            });
                        });
                    });
                    queue_info_DOM.setAttribute('title', 'ダブルクリックで復元');
                    queue_info_DOM.addEventListener('dblclick', event => {
                        deploy();
                    });
                    dropdown_menu_content.addEventListener('click', event => {
                        if (event.target.classList.contains('dropdown-menu-item') === false) {
                            return;
                        }
                        const dropdown_menu_item = event.target;
                        const data_action = dropdown_menu_item.getAttribute('data-action');
                        if (data_action === 'deploy') {
                            deploy();
                        }
                        if (data_action === 'rename') {
                            rename();
                        }
                        if (data_action === 'remove') {
                            if (confirm('本当に削除しますか?') === false) {
                                return;
                            }
                            queuesManager.requestTransaction(() => {
                                return queuesManager.removeSavedQueue(saved_queue.key);
                            });
                        }
                    });
                });
                saved_queues_list_container.innerHTML = '';
                saved_queues_list_container.appendChild(fragment);
            });
        });
    }

    function updateAllWindowQueuesList() {
        return queuesManager.requestTransaction(() => {
            return queuesManager.getAllWindowQueues().then(all_window_queues => {
                const fragment = document.createDocumentFragment();
                all_window_queues.forEach(window_queue => {
                    const window_queue_DOM = generateQueueDOM(window_queue);
                    window_queue_DOM.classList.add('window-queue');
                    fragment.appendChild(window_queue_DOM);
                    const queue_info_DOM = window_queue_DOM.querySelector('.queue-info');
                    const dropdown_menu_root = window_queue_DOM.querySelector('.dropdown-menu-root');
                    const dropdown_menu_content = window_queue_dropdown_menu_content_template.cloneNode(true);

                    function goToTheWindow() {
                        chrome.windows.update(window_queue.windowId, {
                            focused: true
                        });
                    }

                    queue_info_DOM.setAttribute('title', 'ダブルクリックでこのウィンドウに移動');
                    queue_info_DOM.addEventListener('dblclick', event => {
                        goToTheWindow();
                    });
                    dropdown_menu_root.appendChild(dropdown_menu_content);
                    dropdown_menu_content.addEventListener('click', event => {
                        if (event.target.classList.contains('dropdown-menu-item')) {
                            const dropdown_menu_item = event.target;
                            const data_action = dropdown_menu_item.getAttribute('data-action');
                            if (data_action === 'go_to_window') {
                                goToTheWindow();
                            }
                            if (data_action === 'save') {
                                queuesManager.requestTransaction(() => {
                                    return queuesManager.sendWindowQueueToSavedQueues(window_queue.windowId);
                                });
                            }
                            if (data_action === 'remove') {
                                if (confirm('本当に削除しますか?') === false) {
                                    return;
                                }
                                queuesManager.requestTransaction(() => {
                                    return queuesManager.removeWindowQueue(window_queue.windowId);
                                });
                            }
                        }
                    });
                });
                window_queues_list_container.innerHTML = '';
                window_queues_list_container.appendChild(fragment);
            });
        });
    }

    function updateCurrentWindowQueueItemsList() {
        return queuesManager.requestTransaction(() => {
            return new Promise(async (resolve, reject) => {
                const current_window_queue = await queuesManager.getWindowQueue(current_window_id);
                const fragment = document.createDocumentFragment();
                current_window_queue.items.forEach((window_queue_item, queue_item_index) => {
                    const window_queue_item_DOM = generateQueueItemDOM(window_queue_item);
                    fragment.appendChild(window_queue_item_DOM);
                    const lock_icon_DOM = window_queue_item_DOM.querySelector('.lock_icon');
                    const page_info_DOM = window_queue_item_DOM.querySelector('.page-info');
                    const remove_button = window_queue_item_DOM.querySelector('.remove-button');
                    lock_icon_DOM.addEventListener('click', event => {
                        const currently_locked = lock_icon_DOM.classList.contains('locked');
                        queuesManager.requestTransaction(() => {
                            return queuesManager.setPropertiesToWindowQueueItem(
                                current_window_queue.windowId, queue_item_index, {
                                locked: !currently_locked
                            });
                        });
                    });
                    page_info_DOM.setAttribute('title', window_queue_item.url || '');
                    page_info_DOM.addEventListener('click', e => {
                        const delete_item_after_dequeue =
                            window_queue_item.locked ? false : true
                        queuesManager.requestTransaction(() => {
                            return new Promise(async (resolve, reject) => {
                                const window_config =
                                    await configManager.loadWindowConfig(current_window_id);
                                const position_to_dequeue = window_config.position_to_dequeue;
                                await queuesManager.dequeueFromWindowQueue(current_window_id, {
                                    index: queue_item_index,
                                    active: true,
                                    delete: delete_item_after_dequeue,
                                    position: position_to_dequeue,
                                    openerTabId: current_tab_id
                                });
                                resolve();
                            });
                        });
                    });
                    remove_button.addEventListener('click', e => {
                        const locked = lock_icon_DOM.classList.contains('locked');
                        if (locked === true) {
                            if (confirm(
                                'ロックされたアイテムを削除しようとしています\n' +
                                '本当に削除しますか?') === false) {
                                return;
                            }
                        }
                        queuesManager.requestTransaction(() => {
                            return queuesManager.removeItemFromWindowQueue(current_window_id, queue_item_index);
                        });
                    });
                });
                current_window_queue_items_list_container.innerHTML = '';
                current_window_queue_items_list_container.appendChild(fragment);
                resolve();
            });
        });
    }

    const query_string = window.location.search.slice(1);
    /**
     * @type {Array.<string>} `${key}=${value}` の配列
     */
    const query_items = query_string.split('&');
    const query_map = new Map(query_items.map(item => item.split('=')));
    console.log(query_map);

    function placeSavedQueuesList() {
        all_saved_queues_area.style.display = null;
        updateAllSavedQueuesList();
        queuesManager.onSavedQueuesAreaUpdated(changes => {
            console.log('changes', changes)
            updateAllSavedQueuesList();
        });
    }

    function placeWindowQueuesList() {
        all_window_queues_area.style.display = null;
        updateAllWindowQueuesList();
        queuesManager.onWindowQueuesAreaUpdated(changes => {
            updateAllWindowQueuesList();
        });
    }

    function placeCurrentWindowQueueItemsList() {
        current_window_queue_area.style.display = null;
        updateCurrentWindowQueueItemsList();
        queuesManager.onWindowQueueUpdated((windowId, change) => {
            if (windowId !== current_window_id) {
                return;
            }
            console.log('onWindowQueueUpdated', windowId, change)
            updateCurrentWindowQueueItemsList();
        });
        save_button.addEventListener('click', e => {
            queuesManager.requestTransaction(() => {
                return queuesManager.sendWindowQueueToSavedQueues(current_window_id);
            });
        });
        clear_button.addEventListener('click', e => {
            if (window.confirm('キューを削除します') === false) {
                return;
            }
            queuesManager.requestTransaction(() => {
                return queuesManager.removeWindowQueue(current_window_id);
            });
        });
    }

    switch (query_map.get('content')) {
        case 'popup':
            document.body.setAttribute('data-content', 'popup');
            placeSavedQueuesList();
            placeCurrentWindowQueueItemsList();
            break;
        case 'saved-queues':
            document.body.setAttribute('data-content', 'saved-queues');
            document.title = '保存されたキューの一覧';
            placeSavedQueuesList();
            break;
        case 'window-queues':
            document.body.setAttribute('data-content', 'window-queues');
            document.title = 'ウィンドウのキューの一覧';
            placeWindowQueuesList();
            break;
        case 'current-window-queue-items':
            document.body.setAttribute('data-content', 'current-window-queue-items');
            document.title = 'このウィンドウのキュー';
            placeCurrentWindowQueueItemsList();
            break;
        default:
            placeSavedQueuesList();
            placeCurrentWindowQueueItemsList();
            placeWindowQueuesList();
    }

    chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
        if (tabId === current_tab_id) {
            location.reload();
        }
    });
})();
