// content_easync.js
(function() {
    'use strict';

    function parseAddress(addressBlock) {
        try {
            // HATA DÜZELTMESİ: Adres bilgilerini içeren div'i daha spesifik bir şekilde hedefliyoruz.
            // Bu div, içinde kalın (strong) etiketli bir isim barındıran ilk div'dir.
            const infoContainer = addressBlock.querySelector('div:has(> strong)');
            if (!infoContainer) {
                console.error("IndyGrab Error: Adres bilgi konteyneri bulunamadı.");
                return null;
            }

            const lines = Array.from(infoContainer.parentElement.children)
                               .map(el => el.textContent.trim())
                               .filter(line => line && line.toLowerCase() !== 'us');

            if (lines.length < 3) {
                console.error("IndyGrab Error: Adres satırları yetersiz.", lines);
                return null;
            }

            const addressData = {};
            addressData.fullName = lines[0];
            const phoneLine = lines.find(line => line.match(/P:|Phone:/i));
            addressData.phone = phoneLine ? phoneLine.replace(/[^0-9+]/g, '') : '';
            
            const cityStateZipRegex = /(.+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/;
            const cityStateZipLine = lines.find(line => line.match(cityStateZipRegex));
            
            if (!cityStateZipLine) {
                 console.error("IndyGrab Error: Şehir/Eyalet/Posta Kodu satırı bulunamadı veya format hatalı.");
                 return null;
            }

            const match = cityStateZipLine.match(cityStateZipRegex);
            addressData.city = match[1].trim();
            addressData.state = match[2].trim();
            addressData.zip = match[3].trim();

            const addressLines = lines.filter(line => 
                line !== addressData.fullName && 
                line !== phoneLine && 
                line !== cityStateZipLine
            );
            addressData.address1 = addressLines[0] || '';
            addressData.address2 = addressLines[1] || '';
            
            return addressData;
        } catch (error) {
            console.error("IndyGrab Adres Ayrıştırma Hatası:", error);
            return null;
        }
    }

    function injectCopyButton(addressBlock) {
        const buttonContainer = addressBlock.querySelector('button[class*="MuiButton"]')?.parentElement;
        if (!buttonContainer || buttonContainer.querySelector('.indygrab-action-button')) {
            return;
        }

        const copyButton = document.createElement('button');
        copyButton.textContent = 'Adresi Kopyala';
        copyButton.className = 'indygrab-action-button';

        copyButton.addEventListener('click', (e) => {
            e.preventDefault();
            // Adres bloğunu, butonun en üstteki "MuiPaper" atasına göre bul
            const mainAddressContainer = e.target.closest('.MuiPaper-root');
            if (!mainAddressContainer) {
                 copyButton.textContent = '❌ Ana Konteyner Bulunamadı!';
                 setTimeout(() => { copyButton.textContent = 'Adresi Kopyala'; }, 3000);
                 return;
            }

            const addressData = parseAddress(mainAddressContainer);
            if (addressData) {
                chrome.storage.local.set({ 'easyncAddress': addressData }, () => {
                    copyButton.textContent = '✅ Kopyalandı!';
                    setTimeout(() => { copyButton.textContent = 'Adresi Kopyala'; }, 2500);
                });
            } else {
                copyButton.textContent = '❌ Bilgiler Okunamadı!';
                setTimeout(() => { copyButton.textContent = 'Adresi Kopyala'; }, 3000);
            }
        });
        
        buttonContainer.appendChild(copyButton);
    }

    const observer = new MutationObserver(() => {
        const addressHeader = Array.from(document.querySelectorAll('h6')).find(h => h.textContent.trim() === 'Address');
        if (addressHeader && addressHeader.parentElement) {
            injectCopyButton(addressHeader.parentElement);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
