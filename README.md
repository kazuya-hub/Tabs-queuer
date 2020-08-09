
# Tabs queuer

* Chromeの拡張機能です
* [既存の拡張機能](https://chrome.google.com/webstore/detail/tabs-limiter-with-queue/kaamkonbephafcojgajnbgbdgbgbboap)を参考にしています
* [chrome ウェブストアにて公開中](https://chrome.google.com/webstore/detail/tabs-queuer/kdngiphleonkipokblamemlkdhgfagjc)

## ディレクトリ

* [src](./src)  
    拡張機能のルートディレクトリ
* [CHANGELOG.md](./CHANGELOG.md)  
    更新の履歴

## この拡張機能の概要

### キュー

タブを一旦閉じておいて、後から開き直すことができます

* 右クリックメニューから  
    タブやリンクをキューにしまう
* 自動格納  
    ウィンドウ内のタブの数が増えすぎた時に、
    自動でタブをキューに格納します  
    chrome固有のタブは自動格納されません
* 自動展開  
    ウィンドウ内のタブの数が少なくなってきたら、
    自動でキューからタブを取り出します

#### ウィンドウのキュー

chromeのウィンドウに紐づけられたキューです  
アイテムをダブルクリックすることで、そのウィンドウのタブとして取り出すことができます

#### 保存されたキュー

ウィンドウから切り離して保存されたキューです  
Chromeが終了する時に残っていたウィンドウキューは保存されます  
保存されたキューをダブルクリックすると、現在のウィンドウのキューに展開されます

### 設定

自動格納や自動展開の条件などを設定することができます

* 共有設定  
    全てのウィンドウに適用される設定
* ウィンドウ設定  
    ウィンドウごとの設定
    共有設定よりも優先されます
