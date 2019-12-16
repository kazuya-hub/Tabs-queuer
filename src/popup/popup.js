'use strict';

const tab_items_area = document.getElementById('tab-items-area');
const tab_contents_area = document.getElementById('tab-contents-area');

function updateTabContents() {
    // .tab-itemの要素の.selectedを削除する
    const current_selected_tabs = tab_items_area.querySelectorAll('.tab-item.selected');
    current_selected_tabs.forEach(selected_tab => {
        selected_tab.classList.remove('selected');
    });
    // .tab-contents-itemの要素の.showingを削除する
    const current_showing_contents = tab_contents_area.querySelectorAll('.tab-content-item.showing');
    current_showing_contents.forEach(showing_content => {
        showing_content.classList.remove('showing');
    });
    // 選択されているラジオボタンのvalue属性と同じ値をid属性に持つタブを選択した状態にする
    const checked_radioButton = tab_items_area.querySelector('input[type="radio"][name="tabs"]:checked');
    if (checked_radioButton) {
        const target_tabItem = checked_radioButton.closest('.tab-item');
        const target_tabContentsItem = document.getElementById(checked_radioButton.value);
        if (target_tabItem && target_tabContentsItem) {
            target_tabItem.classList.add('selected');
            target_tabContentsItem.classList.add('showing');
        }
    }
}

tab_items_area.onchange = event => {
    updateTabContents();
}

updateTabContents();
