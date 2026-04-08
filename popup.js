// 扩展弹窗逻辑：只展示当前详情页解析到的媒体列表，并提供下载入口。
const FLOATING_DOWNLOAD_KEY = 'floatingDownloadEnabled';

function getQualityLabel(source, url) {
    const s = String(source || '');
    if (s.includes('coverUrlMap-0') || (url || '').includes('aigc_resize_0_0') || (url || '').includes('aigc_resize:0:0')) return '原图';
    const urlSize = (url || '').match(/(?:aigc_resize|resize)[_:](\d{3,4})/i)?.[1]
        || (url || '').match(/[_-](\d{3,4})[_x]\d{3,4}/)?.[1];
    if (urlSize) return `${urlSize}px`;
    if (s.includes('4096')) return '4096px';
    if (s.includes('2400')) return '2400px';
    if (s.includes('largeImages')) return '高清原图';
    if (s.includes('originVideo')) return '原画视频';
    if (s.includes('2160')) return '4K 视频';
    if (s.includes('1080')) return '1080p 视频';
    if (s.includes('720')) return '720p 视频';
    return '标准画质';
}

class PopupManager {
    constructor() {
        this.currentTab = null;
        this.mediaItems = [];
        this.floatingDownloadEnabled = true;
        this.init();
    }

    async init() {
        await this.getCurrentTab();
        await this.loadSettings();
        this.bindEvents();
        await this.refreshStatus();
    }

    async loadSettings() {
        const data = await chrome.storage.local.get([FLOATING_DOWNLOAD_KEY]);
        this.floatingDownloadEnabled = data[FLOATING_DOWNLOAD_KEY] !== false;
        this.renderFloatingDownloadToggle();
    }

    // 读取当前活动标签页，后续所有操作都基于这个标签页发送消息。
    async getCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        this.currentTab = tab || null;
    }

    // 绑定弹窗里的按钮。
    bindEvents() {
        document.getElementById('primaryDownloadBtn')?.addEventListener('click', () => {
            if (this.mediaItems.length === 1) {
                this.downloadItem(this.mediaItems[0], document.getElementById('primaryDownloadBtn'));
            }
        });
        document.getElementById('floatingDownloadToggle')?.addEventListener('change', async (event) => {
            await this.updateFloatingDownloadSetting(Boolean(event.target.checked));
        });
        document.querySelectorAll('[data-url]').forEach((el) => {
            el.addEventListener('click', () => this.openUrl(el.getAttribute('data-url')));
        });
    }

    async updateFloatingDownloadSetting(enabled) {
        this.floatingDownloadEnabled = enabled;
        this.renderFloatingDownloadToggle();
        await chrome.storage.local.set({ [FLOATING_DOWNLOAD_KEY]: enabled });
        await this.notifyCurrentTabFloatingDownload(enabled);
    }

    isSupportedHost(url) {
        return typeof url === 'string' && (
            url.includes('jimeng.jianying.com') ||
            url.includes('dreamina.capcut.com')
        );
    }

    renderFloatingDownloadToggle() {
        const toggleEl = document.getElementById('floatingDownloadToggle');
        if (toggleEl) toggleEl.checked = this.floatingDownloadEnabled;
    }

    async notifyCurrentTabFloatingDownload(enabled) {
        if (!this.currentTab?.id) return;
        if (!this.isSupportedHost(this.currentTab.url)) return;
        try {
            await chrome.tabs.sendMessage(this.currentTab.id, {
                action: 'setFloatingDownloadEnabled',
                enabled
            });
        } catch {}
    }

    openUrl(url) {
        if (!url) return;
        chrome.tabs.create({ url });
    }

    // 主动向内容脚本请求当前详情页的最新解析结果。
    async refreshStatus() {
        if (!this.currentTab?.id) {
            this.renderUnsupported('无法识别当前标签页');
            return;
        }

        if (!this.isSupportedHost(this.currentTab.url)) {
            this.renderUnsupported('当前页面不是即梦或 Dreamina');
            return;
        }

        try {
            const response = await chrome.tabs.sendMessage(this.currentTab.id, { action: 'refresh' });
            if (!response?.success) {
                const errorText = response?.error ? `页面脚本异常：${response.error}` : '页面脚本未响应';
                this.renderUnsupported(errorText);
                return;
            }

            if (!response.supported) {
                this.renderUnsupported('当前页面不是详情页');
                return;
            }

            this.mediaItems = response.mediaItems || [];
            if (typeof response.floatingDownloadEnabled === 'boolean' && response.floatingDownloadEnabled !== this.floatingDownloadEnabled) {
                this.floatingDownloadEnabled = response.floatingDownloadEnabled;
                this.renderFloatingDownloadToggle();
            }
            this.renderStatus(response);
        } catch {
            this.renderUnsupported('页面脚本未响应');
        }
    }

    // 当当前页面不支持时，显示空状态。
    renderUnsupported(message) {
        this.mediaItems = [];
        this.renderHeader(message, false);
        this.renderPrimaryAction([]);
        this.renderList([]);
    }

    // 根据内容脚本返回的页面策略，更新弹窗头部和媒体列表。
    renderStatus(data) {
        const pageType = data.pageStrategy === 'video'
            ? '即梦视频详情页'
            : data.pageStrategy === 'image'
                ? '即梦图片详情页'
                : (data.pageStrategyLabel || '即梦详情页');
        const mediaItems = data.mediaItems || [];
        this.renderHeader(pageType, true);
        this.renderPrimaryAction(mediaItems);
        this.renderList(mediaItems);
    }

    renderHeader(status, active) {
        const statusEl = document.getElementById('pluginStatus');
        const indicatorEl = document.getElementById('statusIndicator');

        if (statusEl) statusEl.textContent = status;
        if (indicatorEl) indicatorEl.className = `status-indicator ${active ? 'status-active' : 'status-inactive'}`;
    }

    renderPrimaryAction(mediaItems) {
        const wrapEl = document.getElementById('primaryActionWrap');
        const buttonEl = document.getElementById('primaryDownloadBtn');
        if (!wrapEl || !buttonEl) return;

        if (mediaItems.length !== 1) {
            wrapEl.classList.add('hidden');
            buttonEl.disabled = false;
            buttonEl.textContent = '去水印下载';
            return;
        }

        wrapEl.classList.remove('hidden');
        buttonEl.disabled = false;
        buttonEl.textContent = mediaItems[0].type === 'video' ? '去水印下载视频' : '去水印下载图片';
    }

    // 根据解析结果渲染媒体列表。
    renderList(mediaItems) {
        const listEl = document.getElementById('mediaList');
        const emptyEl = document.getElementById('emptyState');
        if (!listEl || !emptyEl) return;

        listEl.innerHTML = '';
        if (!mediaItems.length) {
            emptyEl.classList.remove('hidden');
            return;
        }

        emptyEl.classList.add('hidden');

        mediaItems.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'media-item';

            const meta = document.createElement('div');
            meta.className = 'media-meta';

            const title = document.createElement('div');
            title.className = 'media-title';
            title.textContent = item.type === 'video' ? '视频' : '图片';

            const filename = document.createElement('div');
            filename.className = 'media-url';
            filename.textContent = item.filename;

            const source = document.createElement('div');
            source.className = 'media-source';
            const qualityLabel = getQualityLabel(item.source, item.url);
            source.textContent = qualityLabel ? `资源级别：${qualityLabel}` : item.source;

            meta.appendChild(title);
            meta.appendChild(filename);
            meta.appendChild(source);

            row.appendChild(meta);

            if (mediaItems.length > 1) {
                const button = document.createElement('button');
                button.className = 'media-download-btn';
                button.textContent = '去水印下载';
                button.addEventListener('click', () => this.downloadItem(item, button));
                row.appendChild(button);
            }

            listEl.appendChild(row);
        });
    }

    // 通过 background.js 触发浏览器原生下载。
    async downloadItem(item, button) {
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = '下载中';

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'downloadFile',
                url: item.url,
                filename: item.filename,
                mediaType: item.type,
                source: item.source,
                extraImageCandidates: item.type === 'image' ? (item.extraImageCandidates || []) : [],
                preferBlob: item.type === 'image',
                pageUrl: this.currentTab?.url || ''
            });

            if (!response?.success) {
                throw new Error(response?.error || '下载失败');
            }

            button.textContent = '已开始';
        } catch (error) {
            button.textContent = error?.message ? `失败：${error.message.slice(0, 12)}` : '下载失败';
        }

        setTimeout(() => {
            button.disabled = false;
            button.textContent = originalText;
            this.renderPrimaryAction(this.mediaItems);
        }, 1500);
    }

}

document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});
