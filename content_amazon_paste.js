// content_amazon_paste.js
(function() {
    'use strict';

    // Sadece adres içeren sayfalarda çalış
    if (!window.location.href.includes('/address') && !window.location.href.includes('/checkout/')) {
        return;
    }
    console.log("IndyGrab: Amazon paste script bu sayfada aktif.");

    let buttonInjected = false; // Butonun tekrar tekrar eklenmesini önlemek için bayrak

    function setFieldValue(selector, value) {
        const element = document.querySelector(selector);
        if (element) {
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function pasteAddressFromStorage() {
        chrome.storage.local.get('easyncAddress', (result) => {
            if (result.easyncAddress) {
                const addr = result.easyncAddress;
                console.log("IndyGrab: Adres yapıştırılıyor:", addr);

                setFieldValue('#address-ui-widgets-enterAddressFullName', addr.fullName);
                setFieldValue('#address-ui-widgets-enterAddressPhoneNumber', addr.phone);
                setFieldValue('#address-ui-widgets-enterAddressLine1', addr.address1);
                setFieldValue('#address-ui-widgets-enterAddressLine2', addr.address2);
                setFieldValue('#address-ui-widgets-enterAddressCity', addr.city);
                setFieldValue('#address-ui-widgets-enterAddressPostalCode', addr.zip);

                const stateDropdown = document.querySelector('#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId');
                if (stateDropdown && addr.state) {
                    const stateAbbr = addr.state.toUpperCase();
                    if (stateDropdown.querySelector(`option[value="${stateAbbr}"]`)) {
                        stateDropdown.value = stateAbbr;
                        stateDropdown.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
                chrome.storage.local.remove('easyncAddress');
            }
        });
    }

    function injectPasteButton(anchorElement) {
        if (!anchorElement) return;

        const pasteButton = document.createElement('button');
        pasteButton.textContent = '⚡ IndyGrab: Adresi Yapıştır';
        pasteButton.className = 'indygrab-action-button';

        pasteButton.addEventListener('click', (event) => {
            event.preventDefault();
            pasteAddressFromStorage();
            pasteButton.textContent = '✅ Adres Yapıştırıldı!';
            pasteButton.disabled = true;
        });

        anchorElement.insertAdjacentElement('afterend', pasteButton);
        console.log("IndyGrab: Yapıştır butonu başarıyla eklendi.");
    }
    
    // Formu ve butonu bulup ekleyecek ana fonksiyon
    function findAndInject() {
        if (buttonInjected) return; // Buton zaten eklendiyse tekrar arama

        // GÜNCELLEME: Hem tam sayfa hem de pop-up form başlıklarını daha kesin hedefler
        const formHeader = document.querySelector(
            '#address-ui-widgets-enterAddressFormContainer h2, .a-popover-header h4.a-popover-header-content'
        );

        if (formHeader) {
            // Butonun sadece hafızada adres varken görünmesini sağla
            chrome.storage.local.get('easyncAddress', (result) => {
                if (result.easyncAddress && !buttonInjected) {
                    injectPasteButton(formHeader);
                    buttonInjected = true; // Bayrağı ayarla
                }
            });
        }
    }

    // Strateji 1: Sayfa yapısı değiştiğinde anında tepki ver (En verimli yöntem)
    const observer = new MutationObserver(findAndInject);
    observer.observe(document.body, { childList: true, subtree: true });

    // Strateji 2: Garanti Yöntem (Eğer observer formu kaçırırsa diye)
    // Sayfa yüklendikten sonraki ilk 10 saniye boyunca saniyede bir formu kontrol et
    let checkCount = 0;
    const interval = setInterval(() => {
        if (buttonInjected || checkCount >= 10) {
            clearInterval(interval);
            return;
        }
        findAndInject();
        checkCount++;
    }, 1000);

})();
