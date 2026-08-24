// ==UserScript==
// @name         ReManga — Управление прочитанными главами
// @namespace    https://github.com/Dimalanb/remanga-chapter-editor
// @version      0.7.9
// @author       dimalanb
// @description  Отмечает выбранное количество глав прочитанными или непрочитанными
// @homepageURL  https://github.com/Dimalanb/remanga-chapter-editor
// @source       https://github.com/Dimalanb/remanga-chapter-editor
// @license      Apache-2.0
// @match        https://remanga.org/manga/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const API = 'https://api.remanga.org';

    let branchId = null;
    let authToken = null;
    let navigationId = 0;
    let navigationStartedAt = performance.now();

    const READ_BUTTON_TEXT = '✓ Отметить прочитанными главы';
    const UNREAD_BUTTON_TEXT = '✕ Отметить непрочитанными главы';

    // ============================================================
    // ДАННЫЕ ИЗ КОНТЕКСТА СТРАНИЦЫ
    // ============================================================

    window.addEventListener('message', event => {
        if (
            event.source !== window ||
            !event.data ||
            event.data.source !== 'REMANGA_MARK_READ'
        ) {
            return;
        }

        const data = event.data;

        if (
            data.type === 'AUTH_TOKEN' &&
            typeof data.token === 'string'
        ) {
            authToken = data.token;

            console.log(
                '[ReManga] Авторизация обнаружена.'
            );

            return;
        }

        if (
            data.type === 'BRANCH_ID' &&
            typeof data.branchId === 'string'
        ) {
            /*
             * Важно:
             * branch_id должен относиться именно к текущей
             * странице/навигации.
             *
             * injectedCode передаёт navigation URL,
             * который был актуален в момент запроса.
             */
            if (
                typeof data.pageUrl === 'string' &&
                data.pageUrl !== location.href
            ) {
                console.log(
                    '[ReManga] Игнорирую branch_id от старой страницы:',
                    data.branchId
                );

                return;
            }

            branchId = data.branchId;

            console.log(
                '[ReManga] Получен branch_id:',
                branchId
            );
        }
    });

    // ============================================================
    // ПЕРЕХВАТ ЗАПРОСОВ REMANGA
    // ============================================================

    const injectedCode = `
        (() => {
            const SOURCE = 'REMANGA_MARK_READ';

            function send(type, data) {
                window.postMessage({
                    source: SOURCE,
                    type,
                    ...data
                }, '*');
            }

            function inspectUrl(url) {
                try {
                    if (!url) {
                        return;
                    }

                    const parsed = new URL(
                        typeof url === 'string'
                            ? url
                            : url.url,
                        location.origin
                    );

                    const branch =
                        parsed.searchParams.get('branch_id');

                    if (branch) {
                        send('BRANCH_ID', {
                            branchId: branch,
                            pageUrl: location.href
                        });
                    }
                } catch (e) {}
            }

            const originalOpen =
                XMLHttpRequest.prototype.open;

            XMLHttpRequest.prototype.open =
                function (method, url) {
                    inspectUrl(url);

                    return originalOpen.apply(
                        this,
                        arguments
                    );
                };

            const originalSetRequestHeader =
                XMLHttpRequest.prototype.setRequestHeader;

            XMLHttpRequest.prototype.setRequestHeader =
                function (name, value) {
                    if (
                        typeof name === 'string' &&
                        name.toLowerCase() === 'authorization' &&
                        typeof value === 'string' &&
                        value.startsWith('Bearer ')
                    ) {
                        send('AUTH_TOKEN', {
                            token: value.substring(7)
                        });
                    }

                    return originalSetRequestHeader.call(
                        this,
                        name,
                        value
                    );
                };

            const originalFetch = window.fetch;

            window.fetch = function (input, init) {
                try {
                    if (
                        typeof input === 'string'
                    ) {
                        inspectUrl(input);
                    } else if (
                        input &&
                        typeof input === 'object'
                    ) {
                        inspectUrl(input);
                    }

                    let headers = null;

                    if (
                        init &&
                        init.headers
                    ) {
                        headers = init.headers;
                    } else if (
                        input &&
                        typeof input === 'object' &&
                        input.headers
                    ) {
                        headers = input.headers;
                    }

                    if (!headers) {
                        return originalFetch.apply(
                            this,
                            arguments
                        );
                    }

                    let auth = null;

                    if (
                        headers instanceof Headers
                    ) {
                        auth = headers.get(
                            'Authorization'
                        );
                    } else if (
                        Array.isArray(headers)
                    ) {
                        const found = headers.find(
                            item =>
                                Array.isArray(item) &&
                                typeof item[0] === 'string' &&
                                item[0].toLowerCase() ===
                                    'authorization'
                        );

                        if (found) {
                            auth = found[1];
                        }
                    } else if (
                        typeof headers === 'object'
                    ) {
                        auth =
                            headers.Authorization ||
                            headers.authorization;
                    }

                    if (
                        typeof auth === 'string' &&
                        auth.startsWith('Bearer ')
                    ) {
                        send('AUTH_TOKEN', {
                            token: auth.substring(7)
                        });
                    }
                } catch (e) {}

                return originalFetch.apply(
                    this,
                    arguments
                );
            };
        })();
    `;

    function injectInterceptor() {
        const script =
            document.createElement('script');

        script.textContent = injectedCode;

        (
            document.documentElement ||
            document.head
        ).appendChild(script);

        script.remove();
    }

    injectInterceptor();

    // ============================================================
    // ПОИСК BRANCH_ID
    // ============================================================

    function findBranchId() {
        const entries =
            performance.getEntriesByType('resource');

        for (
            let i = entries.length - 1;
            i >= 0;
            i--
        ) {
            const entry = entries[i];

            /*
             * Не используем ресурсы, загруженные до текущей
             * SPA-навигации.
             */
            if (
                entry.startTime <
                navigationStartedAt
            ) {
                continue;
            }

            if (
                !entry.name.includes(
                    '/api/v2/titles/chapters/'
                )
            ) {
                continue;
            }

            try {
                const url =
                    new URL(entry.name);

                const id =
                    url.searchParams.get('branch_id');

                if (id) {
                    branchId = id;

                    console.log(
                        '[ReManga] branch_id из текущей навигации:',
                        branchId
                    );

                    return true;
                }
            } catch (e) {}
        }

        return false;
    }

    async function waitForBranchId(timeout = 5000) {
        const startedAt = Date.now();

        while (
            Date.now() - startedAt <
            timeout
        ) {
            if (branchId) {
                return branchId;
            }

            await new Promise(
                resolve =>
                    setTimeout(resolve, 100)
            );
        }

        return null;
    }

    // ============================================================
    // ПОЛУЧЕНИЕ ГЛАВ
    // ============================================================

    async function getChaptersPage(page) {
        if (!branchId) {
            throw new Error(
                'Не найден branch_id'
            );
        }

        if (!authToken) {
            throw new Error(
                'Не удалось получить авторизацию ReManga'
            );
        }

        const url =
            `${API}/api/v2/titles/chapters/` +
            `?branch_id=${encodeURIComponent(branchId)}` +
            `&chapter=` +
            `&ordering=-index` +
            `&page=${page}` +
            `&user_data=1`;

        const response = await fetch(
            url,
            {
                method: 'GET',
                headers: {
                    'Accept': '*/*',
                    'Authorization':
                        `Bearer ${authToken}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(
                `Ошибка получения глав: HTTP ${response.status}`
            );
        }

        return await response.json();
    }

    async function getAllChapters() {
        const chapters = [];
        let page = 1;

        while (true) {
            const data =
                await getChaptersPage(page);

            if (
                !data ||
                !Array.isArray(data.results)
            ) {
                throw new Error(
                    'API вернул неожиданный формат'
                );
            }

            chapters.push(
                ...data.results
            );

            if (!data.next) {
                break;
            }

            if (
                typeof data.next === 'number'
            ) {
                page = data.next;

            } else if (
                typeof data.next === 'string'
            ) {
                try {
                    const nextUrl =
                        new URL(
                            data.next,
                            API
                        );

                    page = Number(
                        nextUrl.searchParams.get(
                            'page'
                        )
                    );

                } catch (e) {
                    page = Number(data.next);
                }

            } else {
                page = Number(data.next);
            }

            if (!Number.isFinite(page)) {
                throw new Error(
                    `Некорректный next: ${data.next}`
                );
            }
        }

        return chapters;
    }

    // ============================================================
    // API: ПРОЧИТАНО
    // ============================================================

    async function markAsRead(ids) {
        if (!ids.length) {
            return;
        }

        const response = await fetch(
            `${API}/api/activity/views/`,
            {
                method: 'POST',

                headers: {
                    'Accept': '*/*',
                    'Content-Type':
                        'application/json',
                    'Authorization':
                        `Bearer ${authToken}`
                },

                body: JSON.stringify({
                    chapter_ids: ids
                })
            }
        );

        if (!response.ok) {
            const text =
                await response.text();

            throw new Error(
                `Ошибка отметки глав: HTTP ${response.status} — ${text}`
            );
        }
    }

    // ============================================================
    // API: НЕ ПРОЧИТАНО
    // ============================================================

    async function markAsUnread(ids) {
        if (!ids.length) {
            return;
        }

        const response = await fetch(
            `${API}/api/activity/views/`,
            {
                method: 'DELETE',

                headers: {
                    'Accept': '*/*',
                    'Content-Type':
                        'application/json',
                    'Authorization':
                        `Bearer ${authToken}`
                },

                body: JSON.stringify({
                    chapter_ids: ids
                })
            }
        );

        if (!response.ok) {
            const text =
                await response.text();

            throw new Error(
                `Ошибка снятия отметки глав: HTTP ${response.status} — ${text}`
            );
        }
    }

    // ============================================================
    // ОКНО ВЫБОРА КОЛИЧЕСТВА
    // ============================================================

    function showChapterDialog(
        chapters,
        button,
        mode
    ) {
        const isReadMode =
            mode === 'read';

        const actionText =
            isReadMode
                ? 'прочитанными'
                : 'непрочитанными';

        const actionText2 =
            isReadMode
                ? 'первых'
                : 'последних';

        const selectedButtonText =
            isReadMode
                ? READ_BUTTON_TEXT
                : UNREAD_BUTTON_TEXT;

        const overlay =
            document.createElement('div');

        overlay.id =
            'remanga-chapter-overlay';

        Object.assign(
            overlay.style,
            {
                position: 'fixed',
                inset: '0',
                background: 'rgba(0, 0, 0, 0.65)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '999999',
                padding: '20px',
                boxSizing: 'border-box'
            }
        );

        const modal =
            document.createElement('div');

        Object.assign(
            modal.style,
            {
                width: '100%',
                maxWidth: '420px',
                background: '#18181b',
                color: '#fff',
                borderRadius: '12px',
                padding: '24px',
                boxSizing: 'border-box',
                boxShadow:
                    '0 20px 50px rgba(0, 0, 0, 0.45)',
                fontFamily:
                    'Arial, sans-serif'
            }
        );

        const title =
            document.createElement('div');

        title.textContent =
            `Отметить главы ${actionText}`;

        Object.assign(
            title.style,
            {
                fontSize: '20px',
                fontWeight: '700',
                marginBottom: '16px'
            }
        );

        const info =
            document.createElement('div');

        info.innerHTML =
            `Обнаружено ${isReadMode ? 'непрочитанных' : 'прочитанных'} глав: ` +
            `<strong>${chapters.length}</strong>`;

        Object.assign(
            info.style,
            {
                fontSize: '15px',
                lineHeight: '1.5',
                marginBottom: '12px',
                color: '#d4d4d8'
            }
        );

        const description =
            document.createElement('div');

        description.textContent =
            `Введите количество последних глав или оставьте поле пустым, чтобы отметить все ${actionText}.`;

        Object.assign(
            description.style,
            {
                fontSize: '14px',
                lineHeight: '1.5',
                marginBottom: '14px',
                color: '#a1a1aa'
            }
        );

        const input =
            document.createElement('input');

        input.type = 'number';
        input.min = '1';
        input.max = String(chapters.length);
        input.placeholder =
            `Все (${chapters.length})`;

        Object.assign(
            input.style,
            {
                width: '100%',
                padding: '11px 12px',
                border: '1px solid #3f3f46',
                borderRadius: '8px',
                background: '#27272a',
                color: '#fff',
                fontSize: '15px',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: '8px'
            }
        );

        const hint =
            document.createElement('div');

        hint.textContent =
            `Например: 30 — отметить 30 ${actionText2} глав ${actionText}.`;

        Object.assign(
            hint.style,
            {
                fontSize: '12px',
                color: '#71717a',
                marginBottom: '18px'
            }
        );

        const error =
            document.createElement('div');

        Object.assign(
            error.style,
            {
                display: 'none',
                color: '#f87171',
                fontSize: '13px',
                marginBottom: '14px'
            }
        );

        const buttons =
            document.createElement('div');

        Object.assign(
            buttons.style,
            {
                display: 'flex',
                gap: '10px'
            }
        );

        const cancelButton =
            document.createElement('button');

        cancelButton.textContent =
            'Отмена';

        Object.assign(
            cancelButton.style,
            {
                flex: '1',
                padding: '11px 14px',
                border: '1px solid #3f3f46',
                borderRadius: '8px',
                background: '#27272a',
                color: '#fff',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
            }
        );

        const confirmButton =
            document.createElement('button');

        confirmButton.textContent =
            `Отметить ${actionText}`;

        Object.assign(
            confirmButton.style,
            {
                flex: '1',
                padding: '11px 14px',
                border: 'none',
                borderRadius: '8px',
                background:
                    isReadMode
                        ? '#7c3aed'
                        : '#dc2626',
                color: '#fff',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
            }
        );

        function close() {
            overlay.remove();

            button.disabled = false;
            button.textContent =
                selectedButtonText;
        }

        cancelButton.addEventListener(
            'click',
            close
        );

        overlay.addEventListener(
            'click',
            event => {
                if (
                    event.target === overlay
                ) {
                    close();
                }
            }
        );

        input.addEventListener(
            'keydown',
            event => {
                if (event.key === 'Enter') {
                    confirmButton.click();
                }

                if (event.key === 'Escape') {
                    close();
                }
            }
        );

        confirmButton.addEventListener(
            'click',
            async () => {
                error.style.display = 'none';

                const value =
                    input.value.trim();

                let count;

                if (value === '') {
                    count = chapters.length;
                } else {
                    if (!/^\d+$/.test(value)) {
                        error.textContent =
                            'Введите целое число.';

                        error.style.display =
                            'block';

                        return;
                    }

                    count = Number(value);

                    if (
                        count < 1 ||
                        count > chapters.length
                    ) {
                        error.textContent =
                            `Введите число от 1 до ${chapters.length}.`;

                        error.style.display =
                            'block';

                        return;
                    }
                }

                confirmButton.disabled = true;
                cancelButton.disabled = true;
                input.disabled = true;

                confirmButton.textContent =
                    '⏳ Обрабатываю...';

                try {
                    // API отдаёт главы от новых к старым.
                    // Прочитанными отмечаем последние главы,
                    // непрочитанными — первые.
                    const selected =
                        isReadMode
                            ? chapters.slice(-count)
                            : chapters.slice(0, count);

                    const ids =
                        selected.map(
                            chapter =>
                                chapter.id
                        );

                    if (isReadMode) {
                        await markAsRead(ids);
                    } else {
                        await markAsUnread(ids);
                    }

                    overlay.remove();

                    button.textContent =
                        `✓ Обработано ${ids.length}`;

                    console.log(
                        `[ReManga] ${actionText}:`,
                        ids.length
                    );

                    setTimeout(
                        () => location.reload(),
                        1500
                    );

                } catch (err) {
                    console.error(
                        '[ReManga] Ошибка:',
                        err
                    );

                    error.textContent =
                        err.message ||
                        'Не удалось изменить состояние глав.';

                    error.style.display =
                        'block';

                    confirmButton.disabled =
                        false;

                    cancelButton.disabled =
                        false;

                    input.disabled =
                        false;

                    confirmButton.textContent =
                        `Отметить ${actionText}`;
                }
            }
        );

        buttons.appendChild(
            cancelButton
        );

        buttons.appendChild(
            confirmButton
        );

        modal.appendChild(title);
        modal.appendChild(info);
        modal.appendChild(description);
        modal.appendChild(input);
        modal.appendChild(hint);
        modal.appendChild(error);
        modal.appendChild(buttons);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        input.focus();
    }

    // ============================================================
    // ПОДГОТОВКА ОПЕРАЦИИ
    // ============================================================

    async function prepareOperation(
        button,
        mode
    ) {
        button.disabled = true;

        const buttonText =
            mode === 'read'
                ? READ_BUTTON_TEXT
                : UNREAD_BUTTON_TEXT;

        try {
            button.textContent =
                '⏳ Подготавливаю...';

            const currentNavigation =
                navigationId;

            for (
                let i = 0;
                i < 50 && !authToken;
                i++
            ) {
                await new Promise(
                    resolve =>
                        setTimeout(resolve, 100)
                );
            }

            if (!authToken) {
                throw new Error(
                    'Не удалось обнаружить токен авторизации'
                );
            }

            if (!branchId) {
                findBranchId();
            }

            if (!branchId) {
                await waitForBranchId();
            }

            if (!branchId) {
                throw new Error(
                    'Не удалось определить branch_id, обновите страницу'
                );
            }

            if (
                currentNavigation !==
                navigationId
            ) {
                throw new Error(
                    'Страница изменилась во время подготовки. Повторите.'
                );
            }

            console.log(
                '[ReManga] Используем branch_id:',
                branchId
            );

            button.textContent =
                '⏳ Получаю список глав...';

            const chapters =
                await getAllChapters();

            if (!chapters.length) {
                throw new Error(
                    'API вернул 0 глав. Операция отменена, ничего не изменяю.'
                );
            }

            const target =
                mode === 'read'
                    ? chapters.filter(
                        chapter =>
                            chapter.viewed !== true
                    )
                    : chapters.filter(
                        chapter =>
                            chapter.viewed === true
                    );

            console.log(
                '[ReManga] Всего:',
                chapters.length,
                '| Прочитано:',
                chapters.filter(
                    chapter =>
                        chapter.viewed === true
                ).length,
                '| Непрочитано:',
                chapters.filter(
                    chapter =>
                        chapter.viewed !== true
                ).length
            );

            if (!target.length) {
                button.textContent =
                    mode === 'read'
                        ? '✓ Все главы уже прочитаны'
                        : '✓ Нет прочитанных глав';

                setTimeout(() => {
                    if (!button.isConnected) {
                        return;
                    }

                    button.textContent =
                        buttonText;

                    button.disabled =
                        false;
                }, 2500);

                return;
            }

            showChapterDialog(
                target,
                button,
                mode
            );

        } catch (error) {
            console.error(
                '[ReManga] Ошибка:',
                error
            );

            if (button.isConnected) {
                button.textContent =
                    buttonText;

                button.disabled =
                    false;
            }

            alert(
                'Ошибка:\n\n' +
                error.message
            );
        }
    }

    // ============================================================
    // СОЗДАНИЕ КНОПОК
    // ============================================================

    function createButton() {
        if (
            !location.pathname.endsWith(
                '/chapters'
            )
        ) {
            return;
        }

        if (
            document.querySelector(
                '#remanga-mark-all-read'
            )
        ) {
            return;
        }

        if (!document.body) {
            return;
        }

        const reportButton =
            [...document.querySelectorAll('button')]
                .find(
                    el =>
                        el.textContent
                            .trim()
                            .includes(
                                'Пожаловаться'
                            )
                );

        if (!reportButton) {
            return;
        }

        const container =
            reportButton.parentElement;

        if (!container) {
            return;
        }

        const readButton =
            document.createElement('button');

        readButton.id =
            'remanga-mark-all-read';

        readButton.textContent =
            READ_BUTTON_TEXT;

        Object.assign(
            readButton.style,
            {
                marginTop: '10px',
                padding: '10px 16px',
                border: 'none',
                borderRadius: '8px',
                background: '#7c3aed',
                color: 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                width: '100%',
                boxSizing: 'border-box'
            }
        );

        readButton.addEventListener(
            'click',
            () =>
                prepareOperation(
                    readButton,
                    'read'
                )
        );

        const unreadButton =
            document.createElement('button');

        unreadButton.id =
            'remanga-mark-all-unread';

        unreadButton.textContent =
            UNREAD_BUTTON_TEXT;

        Object.assign(
            unreadButton.style,
            {
                marginTop: '10px',
                padding: '10px 16px',
                border: 'none',
                borderRadius: '8px',
                background: '#dc2626',
                color: 'white',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                width: '100%',
                boxSizing: 'border-box'
            }
        );

        unreadButton.addEventListener(
            'click',
            () =>
                prepareOperation(
                    unreadButton,
                    'unread'
                )
        );

        container.appendChild(
            readButton
        );

        container.appendChild(
            unreadButton
        );

        console.log(
            '[ReManga] Кнопки добавлены'
        );
    }

    // ============================================================
    // OBSERVER
    // ============================================================

    const observer =
        new MutationObserver(() => {
            if (
                location.pathname.endsWith(
                    '/chapters'
                )
            ) {
                createButton();
            }
        });

    function startObserver() {
        if (!document.body) {
            return;
        }

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );

        createButton();
    }

    // ============================================================
    // SPA NAVIGATION
    // ============================================================

    function handleNavigation() {
        navigationId++;
        branchId = null;

        console.log(
            '[ReManga] SPA-навигация:',
            location.href
        );

        if (
            !location.pathname.endsWith(
                '/chapters'
            )
        ) {
            return;
        }

        setTimeout(createButton, 100);
        setTimeout(createButton, 500);
        setTimeout(createButton, 1000);
        setTimeout(createButton, 2000);
    }

    const originalPushState =
        history.pushState;

    history.pushState = function () {
        const result =
            originalPushState.apply(
                this,
                arguments
            );

        window.dispatchEvent(
            new Event('remanga-url-change')
        );

        return result;
    };

    const originalReplaceState =
        history.replaceState;

    history.replaceState = function () {
        const result =
            originalReplaceState.apply(
                this,
                arguments
            );

        window.dispatchEvent(
            new Event('remanga-url-change')
        );

        return result;
    };

    window.addEventListener(
        'popstate',
        handleNavigation
    );

    window.addEventListener(
        'remanga-url-change',
        handleNavigation
    );

    // ============================================================
    // INIT
    // ============================================================

    function init() {
        findBranchId();
        startObserver();

        console.log(
            '[ReManga] Скрипт v0.7.9 загружен'
        );
    }

    if (
        document.readyState === 'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            init,
            { once: true }
        );
    } else {
        init();
    }

})();
