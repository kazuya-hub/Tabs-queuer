'use strict';

/*
export文を非同期で使うことはできないようなので、モジュールファイルの中でも動的importは使わないことにする
*/
import * as configManager from '../modules/configManager.js';

// この拡張機能の'キュー'は基本的に First In First Out だが、先頭以外から取り出すこともある
// いい名前が思いつかないので、とりあえず'キュー'と呼んでいる

// chrome.storage APIに保存できるのはJSONで表現できるオブジェクトのみで、メソッド等は保存できない
// => クラスではなく、JSDocの@typedefで構造を定義する



/**
 * トランサクションのIDを引数に受け取り、Promiseを返すコールバック関数
 * 返すPromiseは処理が終了した時にresolveされる必要がある
 * @callback TransactionCallback
 * @param {number} transaction_id
 * @returns {Promise}
 */

/**
 * キュー(とタブ)に関する処理のトランザクションを登録する
 * - background/queuesTransactionManager/queuesTransactionManager.jsと通信する
 * - 登録されたトランザクション同士が同時に実行されることはない
 * - 登録されたトランザクションは登録された順番通りに実行される
 * - 処理に時間がかかりすぎた場合はタイムアウトし、次のトランザクションが実行される  
 * @param {TransactionCallback} callback Promiseを返すコールバック関数
 *   - 返されたPromiseは、一連の処理が終了した時に解決される必要がある
 *   - 返されたPromiseが解決されるまで、他の登録されたトランザクションは実行されない
 *   - 返されたPromiseがrejectされた場合は、  
 *     ストレージ上のキューの領域がcallbackを実行する前の状態にロールバックされる
 *   - Promiseが返されなかった場合は排他制御が出来ない
 * 
 * @returns {Promise.<void>} トランザクションが終了した時に解決されるpromise
 */
export function requestTransaction(callback) {
    return new Promise((outerResolve, outerReject) => {
        const port = chrome.runtime.connect({
            name: 'transaction request for queue operation'
        });
        port.onDisconnect.addListener(port => {
            // 何らかの予想外の事態によって、queuesTransactionManager.js側からポートが閉じられた場合
            outerResolve();
        });
        port.postMessage({
            request: {
                keyword: 'registration'
            }
        });
        port.onMessage.addListener(async (response, port) => {
            // console.log(response)
            if (response.message === 'termination is complete') {
                port.disconnect();
                outerResolve();
            }
            if (response.message === 'allow execution') {
                /** @type {number} トランザクションのID */
                const transaction_id = response.transaction_id;

                /** 
                 * トランザクションを終了するリクエストを送る 
                 */
                function postTerminationRequest() {
                    port.postMessage({
                        request: {
                            keyword: 'termination',
                            args: {
                                transaction_id: transaction_id
                            }
                        }
                    });
                }

                // 処理を開始する前に、ストレージのバックアップを取っておく
                const backup = await new Promise((innerResolve, innerReject) => {
                    chrome.storage.local.get({
                        [QUEUES_KEY_IN_STORAGE.WINDOW_QUEUES]: [],
                        [QUEUES_KEY_IN_STORAGE.SAVED_QUEUES]: []
                    }, result => {
                        innerResolve(result);
                    });
                });
                const returned_promise = callback(transaction_id);
                if ((returned_promise instanceof Promise) === false) {
                    postTerminationRequest();
                    return;
                }

                function rollback() {
                    return new Promise((innerResolve, innerReject) => {
                        chrome.storage.local.set(backup, () => {
                            innerResolve();
                        });
                    });
                };

                returned_promise.then(() => {
                    postTerminationRequest();
                }).catch(async () => {
                    await rollback();
                    postTerminationRequest();
                });
            }
        });
    });
}



/** chrome.storage.local APIでキューを保存するために使うキー */
export const QUEUES_KEY_IN_STORAGE = Object.freeze({
    /** ウィンドウのキュー */
    WINDOW_QUEUES: 'window_queues',
    /** 保存されたキュー */
    SAVED_QUEUES: 'saved_queues'
});


/**
 * キューにしまわれたタブを表現するオブジェクト
 * @typedef {Object} QueueItem
 * @property {string} [title]
 * @property {string} [url]
 * @property {string} [favIconUrl]
 * @property {boolean} [locked] trueならば、このアイテムはqueuesUIでキューから取り出した時に削除されない  
 *                              また、自動展開の対象にもならない
 */

/**
 * QueueItemを作って返す
 * @param {Object} buildProperties 
 *     @param {string} [buildProperties.title]
 *     @param {string} [buildProperties.url]
 *     @param {string} [buildProperties.favIconUrl]
 * 
 * @returns {QueueItem}
 */
export function buildQueueItem(buildProperties) {
    const default_properties = {
        title: '',
        url: '',
        favIconUrl: '',
        locked: false
    };
    /** @type {QueueItem} */
    const complete_queue_item = Object.assign({}, default_properties, buildProperties);
    return complete_queue_item;
}

/**
 * キュー
 * @typedef {Object} Queue
 * @property {Array.<QueueItem>} items
 */

/**
 * ウィンドウに紐付けられたキュー
 * - 紐付けたウィンドウが存在している間のみ有効
 * @typedef {Object} WindowQueue
 * @property {Number} windowId
 * @property {Array.<QueueItem>} items
 */

/**
 * WindowQueueを作って返す
 * @param {Object} buildProperties 
 * @param {Number} buildProperties.windowId
 * @param {Array.<QueueItem>} [buildProperties.items]
 * 
 * @returns {WindowQueue}
 */
export function buildWindowQueue(buildProperties) {
    const windowId = buildProperties.windowId;
    const items = buildProperties.items || new Array();
    /** @type {WindowQueue} */
    const window_queue = {
        windowId,
        items
    }
    return window_queue;
}

function idGeneratorGenerator() {
    let id = 1;
    const idGenerator = function () {
        return id++;
    };
    return idGenerator;
}

/**
 * このjsファイルがアンロードされるまでの間は一意になる整数を生成する
 */
const uniqueNumberGenerator = idGeneratorGenerator();

/**
 * 数値を0埋めした文字列を返す
 * @param {number} number 0埋めする数字
 * @param {number} length 0埋め後の最低桁数
 */
function zeroPadding(number, length) {
    const zeros = '0'.repeat(length);
    return (zeros + String(number)).slice(-length);
}

/**
 * SavedQueueのキーを生成する
 */
function generateSavedQueuesKey() {
    const now = new Date();
    const years = zeroPadding(now.getFullYear(), 4);
    const month = zeroPadding((now.getMonth() + 1), 2);
    const days = zeroPadding(now.getDate(), 2);
    const hours = zeroPadding(now.getHours(), 2);
    const minutes = zeroPadding(now.getMinutes(), 2);
    const seconds = zeroPadding(now.getSeconds(), 2);
    const unique_number = uniqueNumberGenerator();
    const key =
        `${years}/${month}/${days}-${hours}:${minutes}:${seconds}-${unique_number}`;
    return key;
}

/**
 * ウィンドウと切り離して保存されたキュー
 * @typedef {Object} SavedQueue
 * @property {string} key 保存されたキューを見分けるための一意な文字列  
 *   形式:`YYYY/MM/DD-hh:mm:ss-${重複回避用の数字}`
 * @property {string} name ユーザーが自由に変更できる名前
 * @property {Array.<QueueItem>} items
 * @property {boolean} [locked] trueならば、このキューを復元する時にこれを削除しない
 */

/**
 * SavedQueueを構築して返す
 * @param {Object} buildProperties 
 * @param {string} [buildProperties.name]
 * @param {Array.<QueueItem>} [buildProperties.items]
 * 
 * @returns {SavedQueue}
 */
export function buildSavedQueue(buildProperties) {
    const items = buildProperties.items || new Array();
    const key = generateSavedQueuesKey();
    const name = buildProperties.name || key;
    /**
     * @type {SavedQueue}
     */
    const saved_queue = {
        name,
        items,
        key,
        locked: false
    }
    return saved_queue;
}


/**
 * findPropertiesに与えられた条件 **全てに** 合致する **最初の** キューをqueuesの中から見つけて、
 *     queues内でのインデックスを返す
 * - 見つからなかった場合は-1を返す
 * @param {Array.<WindowQueue | SavedQueue>} queues
 * @param {Object} findProperties
 *     @param {number} [findProperties.windowId]
 *     @param {string} [findProperties.key]
 * 
 * @returns {number} index
 */
export function findIndexOfQueue(queues, findProperties) {
    const array_of_queue = queues;
    const windowId = findProperties.windowId;
    const key = findProperties.key;
    // テスト用関数の配列
    const test_functions = [];
    if (windowId !== undefined) {
        test_functions.push(queue => queue.windowId === windowId);
    }
    if (key !== undefined) {
        test_functions.push(queue => queue.key === key);
    }
    // findIndex
    const found_index = array_of_queue.findIndex(queue => {
        return test_functions.every(test => test(queue));
    });
    return found_index;
}

/**
 * findPropertiesに与えられた条件 **全てに** 合致する **最初の** キューをqueuesの中から見つけて返す
 * - 見つからなかった場合はnullを返す
 * @param {Array.<WindowQueue | SavedQueue>} queues
 * 
 * @param {Object} findProperties
 * @param {Number} [findProperties.windowId]
 * @param {String} [findProperties.key]
 * 
 * @returns {Queue}
 */
export function findQueue(queues, findProperties) {
    const found_index = findIndexOfQueue(queues, findProperties);
    return queues[found_index] || null;
}


/**
 * ストレージから全てのウィンドウキューを取得する
 * @param {Object} [getProperties]
 * 
 * @returns {Promise.< Array.<WindowQueue> >} promise
 */
export function getAllWindowQueues(getProperties) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get({
            [QUEUES_KEY_IN_STORAGE.WINDOW_QUEUES]: new Array()
        }, storage => {
            /** @type {Array.<WindowQueue>} 全てのウィンドウキューの配列 */
            const all_window_queues =
                storage[QUEUES_KEY_IN_STORAGE.WINDOW_QUEUES] ||
                new Array();
            return resolve(all_window_queues);
        });
    });
}

/**
 * ストレージ上のウィンドウキューの保存領域を丸ごと上書きする
 * @param {Array.<WindowQueue>} window_queues セットするウィンドウキューの配列
 * @param {Object} [setProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function setAllWindowQueues(window_queues, setProperties) {
    const window_queues_to_set = window_queues;
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({
            [QUEUES_KEY_IN_STORAGE.WINDOW_QUEUES]: window_queues_to_set
        }, () => {
            return resolve();
        });
    });
}

/**
 * 指定したウィンドウのキューを読み込む
 * - ストレージに存在しない場合はitemsが空のウィンドウキューになる
 * @param {Number} windowId
 * @param {Object} [getProperties] 
 * 
 * @returns {Promise.<WindowQueue>} promise
 */
export function getWindowQueue(windowId, getProperties) {
    const target_windowId = windowId;
    return new Promise(async (resolve, reject) => {
        const all_window_queues = await getAllWindowQueues();
        const found_queue = findQueue(all_window_queues, {
            windowId: target_windowId
        });
        const result =
            found_queue ||
            buildWindowQueue({
                windowId: target_windowId
            });
        return resolve(result);
    });
}

/**
 * ウィンドウキューをセットする
 * - 既に存在していた場合は上書きする
 * @param {WindowQueue} window_queue
 * @param {Object} [setProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function setWindowQueue(window_queue, setProperties) {
    const window_queue_to_set = window_queue;
    const target_windowId = window_queue_to_set.windowId;
    return new Promise(async (resolve, reject) => {
        const all_window_queues = await getAllWindowQueues();
        const index_of_target_window_queue = findIndexOfQueue(all_window_queues, {
            windowId: target_windowId
        });
        if (index_of_target_window_queue === -1) {
            // まだウィンドウキューが存在していない
            all_window_queues.push(window_queue_to_set);
        } else {
            // 既にウィンドウキューが存在している
            all_window_queues[index_of_target_window_queue] = window_queue_to_set;
        }
        await setAllWindowQueues(all_window_queues);
        return resolve();
    });
}

/**
 * ウィンドウのキューのアイテムのプロパティをセットする
 * @param {number} windowId 
 * @param {number} index 
 * @param {Object} properties 
 * 
 * @returns {Promise.<void>} 処理が完了したらresolveされるPromise
 */
export function setPropertiesToWindowQueueItem(windowId, index, properties) {
    // console.log('setPropertiesToWindowQueueItem', windowId, index, properties)
    const target_window_id = windowId;
    const target_index = index;
    const properties_to_set = properties;
    return new Promise(async (resolve, reject) => {
        const target_window_queue = await getWindowQueue(target_window_id);
        target_window_queue.items[target_index] =
            Object.assign(
                {},
                target_window_queue.items[target_index],
                properties_to_set
            );
        await setWindowQueue(target_window_queue);
        return resolve();
    });
}

/**
 * 指定したウィンドウのキューを削除する
 * - 既に存在していなかった場合はその時点でresolveする
 * @param {number} windowId
 * @param {Object} [removeProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function removeWindowQueue(windowId, removeProperties) {
    const target_windowId = windowId;
    return new Promise(async (resolve, reject) => {
        const all_window_queues = await getAllWindowQueues();
        const index_of_found = findIndexOfQueue(all_window_queues, {
            windowId: target_windowId
        });
        if (index_of_found === -1) {
            return resolve();
        }
        all_window_queues.splice(index_of_found, 1);
        await setAllWindowQueues(all_window_queues);
        return resolve();
    });
}

/**
 * 指定したウィンドウキューにQueueItemの配列をpushする
 * @param {Number} windowId
 * @param {Array.<QueueItem>} items
 * @param {Object} [pushProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function pushItemsToWindowQueue(windowId, items, pushProperties) {
    const target_windowId = windowId;
    const items_to_push = items;
    return new Promise(async (resolve, reject) => {
        const window_queue = await getWindowQueue(target_windowId);
        const window_config = await configManager.loadWindowConfig(target_windowId);
        // ウィンドウキューが存在しなかったら新しく作る
        const newer_window_queue =
            window_queue || buildWindowQueue({
                windowId: target_windowId
            });

        const url_black_list = new Set();
        if (window_config.ignore_duplicates === true) {
            newer_window_queue.items.forEach(queue_item => {
                url_black_list.add(queue_item.url);
            });
        }

        items_to_push.forEach(queue_item => {
            const url = String(queue_item.url);
            if (url_black_list.has(url) === true) {
                return;
            }

            if (window_config.position_to_enqueue === 'top') {
                newer_window_queue.items.unshift(queue_item);
            }
            if (window_config.position_to_enqueue === 'last') {
                newer_window_queue.items.push(queue_item);
            }

            if (window_config.ignore_duplicates) {
                url_black_list.add(url); // 新しくウィンドウキューに追加したアイテムのURLもブラックリストに追加する
            }
        });
        await setWindowQueue(newer_window_queue);
        return resolve();
    });
}

/**
 * 指定したWindowQueueの指定したindexにあるアイテムを削除して詰める
 * - 削除した結果キューにアイテムが無くなったらキューを削除する
 * @param {number} windowId
 * @param {number} index
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function removeItemFromWindowQueue(windowId, index) {
    const target_windowId = windowId;
    const target_index = index;
    return new Promise(async (resolve, reject) => {
        const target_window_queue = await getWindowQueue(target_windowId);
        target_window_queue.items.splice(target_index, 1);
        if (target_window_queue.items.length === 0) {
            await removeWindowQueue(target_window_queue.windowId);
        } else {
            await setWindowQueue(target_window_queue);
        }
        return resolve();
    });
}

/**
 * ウィンドウキューからページを取り出してタブを作る
 * @param {number} windowId
 * @param {Object} [dequeueProperties] 
 *     @param {number} [dequeueProperties.index] 取り出すアイテムのキュー内でのインデックス　デフォルトは0
 *     @param {boolean} [dequeueProperties.active] 作ったタブをアクティブにするか否か　デフォルトはfalse
 *     @param {boolean} [dequeueProperties.delete] trueならタブを作った後にキューからアイテムを削除する　デフォルトはtrue
 *     @param {string} [dequeueProperties.position] 取り出したタブを配置する位置 デフォルトは'rightmost'
 *         - 'rightmost': 一番右
 *         - 'rightnext': アクティブなタブの右隣
 *     @param {number} [dequeueProperties.openerTabId] タブにopenerTabが設定されていると、タブを閉じた時にopenerTabがアクティブになる
 * 
 * @returns {Promise.<Tab>} 作られたタブをresolveするPromise
 */
export function dequeueFromWindowQueue(windowId, dequeueProperties) {
    const target_windowId = windowId;
    const default_properties = {
        index: 0,
        active: false,
        delete: true,
        position: 'rightmost',
        openerTabId: undefined
    };
    const complete_properties = Object.assign({}, default_properties, dequeueProperties);
    const target_item_index_in_queue = complete_properties.index;
    const active = complete_properties.active;
    const delete_queue_item = complete_properties.delete;
    const position_to_dequeue = complete_properties.position;
    const opener_tab_id = complete_properties.openerTabId;
    return new Promise(async (outerResolve, outerReject) => {
        const target_window = await new Promise((innerResolve, innerReject) => {
            chrome.windows.get(target_windowId, {
                populate: true
            }, result => {
                innerResolve(result);
            });
        });
        const tab_index_in_window = (() => {
            if (position_to_dequeue === 'rightmost') {
                return target_window.tabs.length;
            }
            if (position_to_dequeue === 'rightnext') {
                const active_tab_index =
                    target_window.tabs.findIndex(tab => tab.active === true);
                return active_tab_index + 1;
            }
            // position_to_dequeueが、どのキーワードにも当てはまらなかった場合
            return target_window.tabs.length;
        })();

        const target_window_queue = await getWindowQueue(target_windowId);
        if (target_window_queue === null) {
            return outerReject(new Error('指定されたウィンドウキューが存在しません'));
        }
        const target_queue_item = target_window_queue.items[target_item_index_in_queue];
        if (target_queue_item === undefined) {
            return outerReject(new Error('指定されたアイテムが存在しません'));
        }

        /**
         * タブを作った後のアニメーションが終わるのを待つ  
         * ただ単に一定時間待っているだけ
         * @returns {Promise.<void>}
         */
        function waitForCreatedTabAnimation() {
            return new Promise((innerResolve, innerReject) => {
                setTimeout(() => {
                    innerResolve();
                }, 200);
            });
        }
        /*
        キューからタブを取り出す手順
            1. 非アクティブなタブを作り、ページをロードする
            2. キューからアイテムを削除する
            3. (作ったタブのアニメーションが終わるまで待ってから)プロパティに応じて作ったタブをアクティブにする
            
        こんな手法をとっている理由
            1. ポップアップから呼び出した場合、最初にアクティブなタブを作るとその時点でポップアップが閉じられて処理が終了してしまう
            2. タブをアクティブな状態で作るより、非アクティブな状態で作って後からアクティブにした方が、  
               タブがアニメーションされるのでタブが作成されたことがユーザーにわかりやすい
         */
        const created_tab = await new Promise((innerResolve, innerReject) => {
            chrome.tabs.create({
                windowId: target_windowId,
                index: tab_index_in_window,
                url: target_queue_item.url || '',
                active: false,
                openerTabId: opener_tab_id
            }, result => {
                innerResolve(result);
            });
        });
        const promises = [
            waitForCreatedTabAnimation()
        ];
        if (delete_queue_item === true) {
            const promise = removeItemFromWindowQueue(target_windowId, target_item_index_in_queue);
            promises.push(promise);
        }
        await Promise.all(promises);
        chrome.tabs.update(created_tab.id, {
            active: active
        }, tab => {
            return outerResolve();
        });
    });
}



/**
 * SavedQueueを全て取得する
 * @param {Object} [getProperties] 
 * 
 * @returns {Promise.< Array.<SavedQueue> >} promise
 */
export function getAllSavedQueues(getProperties) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get({
            [QUEUES_KEY_IN_STORAGE.SAVED_QUEUES]: new Array()
        }, result => {
            /**
             * 全てのSavedQueueの配列
             * @type {Array.<SavedQueue>}
             */
            const all_saved_queues = result[QUEUES_KEY_IN_STORAGE.SAVED_QUEUES] || new Array();
            resolve(all_saved_queues);
        });
    });
}

/**
 * chrome.storage.localのSavedQueueの保存領域を丸ごと上書きする
 * @param {Array.<SavedQueue>} queues
 * @param {Object} [setProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise 
 */
export function setAllSavedQueues(queues, setProperties) {
    const queues_to_set = queues;
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({
            [QUEUES_KEY_IN_STORAGE.SAVED_QUEUES]: queues_to_set
        }, () => {
            resolve();
        });
    });
}

/**
 * SavedQueueを取得する
 * @param {string} key 
 * 
 * @returns {Promise.<SavedQueue>}
 */
export function getSavedQueue(key) {
    return new Promise(async (resolve, reject) => {
        const all_saved_queues = await getAllSavedQueues();
        const found_saved_queue =
            findQueue(all_saved_queues, {
                key: key
            });
        return resolve(found_saved_queue);
    });
}

/**
 * 新しいSavedQueueを追加する
 * @param {Queue} queue
 * @param {Object} [pushProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function pushQueueToSavedQueues(queue, pushProperties) {
    const queue_to_push = queue;
    return new Promise(async (resolve, reject) => {
        const new_saved_queue = buildSavedQueue({
            items: queue_to_push.items
        });
        const all_saved_queues = await getAllSavedQueues();
        all_saved_queues.push(new_saved_queue);
        await setAllSavedQueues(all_saved_queues);
        return resolve();
    });
}

/**
 * 保存されたキューをセットする
 * - 既に存在していた場合は上書きする
 * @param {SavedQueue} saved_queue
 * @param {Object} [setProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function setSavedQueue(saved_queue, setProperties) {
    const saved_queue_to_set = saved_queue;
    const target_key = saved_queue_to_set.key;
    return new Promise(async (resolve, reject) => {
        const all_saved_queues = await getAllSavedQueues();
        const index_of_target_saved_queue = findIndexOfQueue(all_saved_queues, {
            key: target_key
        });
        if (index_of_target_saved_queue === -1) {
            // まだ存在していない
            all_saved_queues.push(saved_queue_to_set);
        } else {
            // 既に存在している
            all_saved_queues[index_of_target_saved_queue] = saved_queue_to_set;
        }
        await setAllSavedQueues(all_saved_queues);
        return resolve();
    });
}

/**
 * 保存されたキューのnameプロパティを変更する
 * @param {string} key 
 * @param {string} name 
 */
export function renameSavedQueue(key, name) {
    return new Promise(async (resolve, reject) => {
        const target_saved_queue_key = key;
        const new_name = name;
        const target_saved_queue = await getSavedQueue(target_saved_queue_key);
        if (target_saved_queue === null) {
            return resolve();
        }
        target_saved_queue.name = new_name;
        await setSavedQueue(target_saved_queue);
        return resolve();
    });
}

/**
 * 保存されたキューにプロパティをセットする
 * @param {string} key 
 * @param {Object} properties 
 */
export function setPropertiesToSavedQueue(key, properties) {
    return new Promise(async (resolve, reject) => {
        const target_saved_queue_key = key;
        const properties_to_set = properties;
        const target_saved_queue = await getSavedQueue(target_saved_queue_key);
        if (target_saved_queue === null) {
            return resolve();
        }
        Object.assign(target_saved_queue, properties_to_set);
        await setSavedQueue(target_saved_queue);
        return resolve();
    });
}

/**
 * WindowQueueをSavedQueueに送る
 * @param {Number} windowId
 * @param {Object} [sendProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function sendWindowQueueToSavedQueues(windowId, sendProperties) {
    const target_windowId = windowId;
    return new Promise(async (resolve, reject) => {
        const target_window_queue = await getWindowQueue(target_windowId);
        if (target_window_queue.items.length > 0) {
            await pushQueueToSavedQueues(target_window_queue);
        }
        await removeWindowQueue(target_windowId);
        return resolve();
    });
}

/**
 * SavedQueueを削除する
 * @param {string} key
 * @param {Object} [removeProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function removeSavedQueue(key, removeProperties) {
    const target_key = key;
    return new Promise(async (resolve, reject) => {
        const all_saved_queues = await getAllSavedQueues();
        const found_index = findIndexOfQueue(all_saved_queues, {
            key: target_key
        });
        all_saved_queues.splice(found_index, 1);
        await setAllSavedQueues(all_saved_queues);
        return resolve();
    });
}

/**
 * SavedQueueをウィンドウキューに展開する
 * @param {string} key 展開したいSavedQueueのキー
 * @param {number} windowId
 * @param {Object} [deployProperties] 
 * @param {boolean} [deployProperties.delete] trueなら展開した後にSavedQueueを削除する デフォルトはtrue
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function deploySavedQueueToWindowQueue(key, windowId, deployProperties) {
    const target_key = key;
    const target_windowId = windowId;
    const default_properties = {
        delete: true
    };
    const complete_properties = Object.assign({}, default_properties, deployProperties);
    const delete_queue_after_deploy = complete_properties.delete;
    return new Promise(async (resolve, reject) => {
        const all_saved_queues = await getAllSavedQueues();
        const saved_queue_to_deploy =
            findQueue(all_saved_queues, {
                key: target_key
            });
        if (saved_queue_to_deploy === undefined) {
            return reject(new Error('指定されたSavedQueueが存在しません'));
        }
        await pushItemsToWindowQueue(target_windowId, saved_queue_to_deploy.items);
        if (delete_queue_after_deploy) {
            await removeSavedQueue(target_key);
        }
        return resolve();
    });
}

/**
 * 全てのWindowQueueをSavedQueueに送る
 * @param {Object} [sendProperties] 
 * 
 * @returns {Promise.<Void>} 処理が終了した時にresolveされるpromise
 */
export function sendAllWindowQueuesToSavedQueues(sendProperties) {
    return new Promise(async (resolve, reject) => {
        const all_window_queues = await getAllWindowQueues();
        const all_saved_queues = await getAllSavedQueues();
        all_window_queues.forEach(window_queue => {
            const new_saved_queue = buildSavedQueue({
                items: window_queue.items
            });
            all_saved_queues.push(new_saved_queue);
        });
        await setAllSavedQueues(all_saved_queues);
        await setAllWindowQueues(new Array());
        return resolve();
    });
}

/**
 * @typedef {Object} WindowQueuesAreaUpdate
 * @property {Array.<WindowQueue>} oldValue
 * @property {Array.<WindowQueue>} newValue
 */

/**
 * @callback WidnowQueuesAreaUpdateCallback
 * @param {WindowQueuesAreaUpdate} changes
 */

/**
 * ストレージ上のウィンドウキューの領域が更新された時のイベント
 * @param {WidnowQueuesAreaUpdateCallback} callback
 */
export function onWindowQueuesAreaUpdated(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        const window_queues_changes = changes[QUEUES_KEY_IN_STORAGE.WINDOW_QUEUES];
        if (window_queues_changes) {
            callback(window_queues_changes);
        }
    });
}

/**
 * @typedef {Object} SavedQueuesAreaUpdate
 * @property {Array.<SavedQueue>} oldValue
 * @property {Array.<SavedQueue>} newValue
 */

/**
 * @callback SavedQueuesAreaUpdateCallback
 * @param {SavedQueuesAreaUpdate} changes
 */

/**
 * ストレージ上の保存されたキューの領域が更新された時のイベント
 * @param {SavedQueuesAreaUpdateCallback} callback 
 */
export function onSavedQueuesAreaUpdated(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        const save_queues_changes = changes[QUEUES_KEY_IN_STORAGE.SAVED_QUEUES];
        if (save_queues_changes) {
            callback(save_queues_changes);
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
 * @typedef {Object} WindowQueueUpdate
 * @property {WindowQueue} oldValue
 * @property {WindowQueue} newValue
 */

/**
 * @callback WidnowQueueUpdateCallback
 * @param {number} windowId
 * @param {WindowQueueUpdate} change
 */

/**
 * ウィンドウのキューが更新された時のイベント
 * @param {WidnowQueueUpdateCallback} callback 
 */
export function onWindowQueueUpdated(callback) {
    onWindowQueuesAreaUpdated(changes => {
        const oldValue = changes.oldValue || new Array();
        const newValue = changes.newValue || new Array();
        const oldValue_windowId_list = oldValue.map(queue => queue.windowId);
        const newValue_windowId_list = newValue.map(queue => queue.windowId);
        /**
         * oldValueかnewValueのどちらかに存在した全てのウィンドウキューのウィンドウIDのセット
         * @type {Set.<number>}
         */
        const all_windowId_list = new Set(
            oldValue_windowId_list.concat(newValue_windowId_list)
        );
        all_windowId_list.forEach(windowId => {
            const found_older = findQueue(oldValue, {
                windowId: windowId
            });
            const found_newer = findQueue(newValue, {
                windowId: windowId
            });
            const older_window_queue =
                found_older ||
                buildWindowQueue({ windowId });
            const newer_window_queue =
                found_newer ||
                buildWindowQueue({ windowId });
            if (deepEqual(older_window_queue, newer_window_queue) === false) {
                callback(windowId, {
                    oldValue: older_window_queue,
                    newValue: newer_window_queue
                });
            }
        });
    });
}

/**
 * @typedef {Object} SavedQueueUpdate
 * @property {SavedQueue} oldValue
 * @property {SavedQueue} newValue
 */

/**
 * @callback SavedQueueUpdateCallback
 * @param {string} key
 * @param {SavedQueueUpdate} change
 */

/**
 * 保存されたキューが更新された時のイベント
 * @param {SavedQueueUpdateCallback} callback 
 */
export function onSavedQueueUpdated(callback) {
    onSavedQueuesAreaUpdated(changes => {
        const oldValue = changes.oldValue || new Array();
        const newValue = changes.newValue || new Array();
        const oldValue_key_list = oldValue.map(queue => queue.key);
        const newValue_key_list = newValue.map(queue => queue.key);
        /**
         * oldValueかnewValueのどちらかに存在した全ての保存されたキューのキーのセット
         * @type {Set.<string>}
         */
        const all_key_list = new Set(
            oldValue_key_list.concat(newValue_key_list)
        );
        all_key_list.forEach(key => {
            const found_older = findQueue(oldValue, {
                key: key
            });
            const found_newer = findQueue(newValue, {
                key: key
            });
            const older_saved_queue =
                found_older ||
                buildSavedQueue({ key: key });
            const newer_saved_queue =
                found_newer ||
                buildSavedQueue({ key: key });
            if (deepEqual(older_saved_queue, newer_saved_queue) === false) {
                callback(key, {
                    oldValue: older_saved_queue,
                    newValue: newer_saved_queue
                });
            }
        });
    });
}
