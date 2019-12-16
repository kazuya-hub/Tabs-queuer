'use strict';

/**
 * コンソールにログを出力するか否か
 */
const log_flag = false;

/**
 * @type {number}
 * トランザクションがタイムアウトするまでの時間(ミリ秒)  
 * トランザクションの実行を許可するレスポンスを送ってから、  
 * この変数で設定した時間が経過してもトランザクションの終了を示すメッセージが送られない場合は  
 * 強制的にトランザクションを終了する
 */
const TRANSACTION_TIMEOUT_MS = 30 * 1000;

/**
 * @typedef {Object} Port トランザクションのリクエスト/レスポンスに使うポート [参考](https://developer.chrome.com/apps/runtime#type-Port)
 * @property {string} name
 * @property {function} disconnect
 * @property {Object} onDisconnect
 *     @property {function} onDisconnect.addListener
 * @property {Object} onMessage
 *     @property {function} onMessage.addListener
 * @property {function} postMessage
 * @property {MessageSender} sender
 */

/**
 * @typedef {number} TransactionId トランザクションを識別する為の一意な1以上の整数
 */


function idGeneratorGenerator() {
    let id = 1;
    const idGenerator = function () {
        return id++;
    };
    return idGenerator;
}

const transactionIdGenerator = idGeneratorGenerator();

/**
 * トランザクションの引数を生成する
 */
function generateTransactionId() {
    /** @type {TransactionId} */
    const id = transactionIdGenerator();
    return id;
}

class Transaction {
    /**
     * @param {Port} port 
     */
    constructor(port) {
        this.id = generateTransactionId();
        this.port = port;
    }
}

/**
 * @type {Array.<Transaction>} 待機中のトランザクションの配列 pushで追加して、0番を実行する
 */
const awaiting_transactions = [];

/**
 * @type {boolean} トランザクションが実行されている最中か否か
 */
let is_processing = false;

/**
 * トランザクションが終了される理由
 */
const TERMINATION_REASONS = Object.freeze({
    TIME_OUT: 'timeout',
    PORT_ONDISCONNECT: 'port.onDisconnect',
    TERMINATION_REQUEST: 'termination request'
});

/**
 * トランザクションを登録する
 * @param {Transaction} transaction 
 */
function registerTransaction(transaction) {
    if (log_flag) {
        console.log(new String('register'), transaction.id, transaction.port.sender.url);
    }
    awaiting_transactions.push(transaction);
    executeTransactions();
}

/**
 * 登録されたトランザクションを確認する  
 * トランザクションが実行されていなければ、登録されているトランザクションを実行する
 */
function executeTransactions() {
    if (is_processing === true) {
        return;
    }
    if (awaiting_transactions.length === 0) {
        return;
    }
    const transaction_to_exec = awaiting_transactions[0];
    if ((transaction_to_exec instanceof Transaction) === false) {
        terminateTransaction(transaction_to_exec.id, {
            reason: 'non-transaction was registered in the array'
        });
        return;
    }
    const port = transaction_to_exec.port;
    if ((typeof port.postMessage) !== 'function') {
        terminateTransaction(transaction_to_exec.id, {
            reason: 'port.postMessage is not function'
        });
        return;
    }
    // ここから実際にトランザクションを実行する
    if (log_flag) {
        console.log(new String('exec'), transaction_to_exec.id);
    }
    is_processing = true;
    const response_content = {
        message: 'allow execution',
        transaction_id: transaction_to_exec.id
    };
    if (log_flag) {
        console.log(new String('allow execution  =>'), response_content);
    }
    port.postMessage(response_content);
    setTimeout(() => {
        terminateTransaction(transaction_to_exec.id, {
            reason: TERMINATION_REASONS.TIME_OUT
        });
    }, TRANSACTION_TIMEOUT_MS);
}

/**
 * トランザクションを終了する
 * @param {TransactionId} transaction_id 終了するトランザクションのID
 * @param {Object} [options]
 *     @param {String} [options.reason] トランザクションが終了される理由
 */
function terminateTransaction(transaction_id, options) {
    const target_transaction_id = transaction_id;
    const reason = options ? options.reason : null;
    const found_index = awaiting_transactions.findIndex(transaction => {
        return transaction.id === target_transaction_id;
    });
    if (found_index === -1) {
        return; // 登録されていないトランザクションを指定された場合
    }
    // ここから実際にトランザクションを終了させる
    if (log_flag) {
        console.log(new String('terminate'), transaction_id, options);
    }
    const result = awaiting_transactions.splice(found_index, 1);
    const terminated_transaction = result[0];
    if (reason !== TERMINATION_REASONS.PORT_ONDISCONNECT) {
        // トランザクションが終了したことを知らせるレスポンスを送る
        terminated_transaction.port.postMessage({
            message: 'termination is complete'
        });
    }
    if (found_index === 0) {
        // 実行中のトランザクションを終了した場合は次のトランザクションを実行する
        is_processing = false;
        executeTransactions();
    }
    if (reason === TERMINATION_REASONS.TIME_OUT) {
        throw new Error(`トランザクションがタイムアウトしました id:${terminated_transaction.id}`);
    }
}


chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'transaction request for queue operation') {
        const transaction = new Transaction(port);

        port.onMessage.addListener((message, port) => {
            if (log_flag) {
                console.log('port.onMessage', message.request);
            }

            if (message.request.keyword === 'registration') {
                if (log_flag) {
                    console.log(new String('<=  registration'), port.sender.url, message.request.args);
                }
                registerTransaction(transaction);
            }

            if (message.request.keyword === 'termination') {
                if (log_flag) {
                    console.log(new String('<=  termination'), message.request.args);
                }
                const transaction_id = message.request.args.transaction_id;
                terminateTransaction(transaction_id, {
                    reason: TERMINATION_REASONS.TERMINATION_REQUEST
                });
            }
        });
        
        port.onDisconnect.addListener(port => {
            // 接続が切断された場合はトランザクションを終了する
            terminateTransaction(transaction.id, {
                reason: TERMINATION_REASONS.PORT_ONDISCONNECT
            });
        });
    }
});
