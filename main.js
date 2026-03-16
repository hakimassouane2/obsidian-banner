/*
 * obsidian-banner – lightweight banner plugin for Obsidian
 */

const { Plugin, PluginSettingTab, Setting, debounce } = require("obsidian");

// ── Default settings ────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
    bannerField: "art",
    showField: "banner",
    yPositionField: "banner-y",
    bannerHeight: 350,
    contentStartPosition: 355,
    bannerMaxWidth: 2560,
    xPosition: 50,
    yPosition: 50,
    fade: -40,
    borderRadius: 0,
    bannerGap: 0,
    showInPopover: false,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractLinkName(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) {
        raw = raw[0];
        if (!raw) return null;
    }
    const str = String(raw).trim();
    const m = str.match(/!?\[\[(.*?)\]\]/);
    return m ? m[1] : str;
}

function resolveImage(app, name, sourcePath) {
    if (!name) return null;
    let file = app.vault.getAbstractFileByPath(name);
    if (file && file.extension) return file;
    file = app.metadataCache.getFirstLinkpathDest(name, sourcePath || "");
    if (file && file.extension) return file;
    return null;
}

// ── Main plugin class ────────────────────────────────────────────────────────

class BannerPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new BannerSettingTab(this.app, this));

        this._urlCache = new Map();

        // Fast debounce for metadata changes
        this._debouncedUpdate = debounce(() => this.refreshAllLeaves(), 80, true);

        this.registerEvent(
            this.app.metadataCache.on("changed", () => this._debouncedUpdate())
        );
        this.registerEvent(
            this.app.workspace.on("layout-change", () => this._debouncedUpdate())
        );
        // file-open fires immediately when switching notes
        this.registerEvent(
            this.app.workspace.on("file-open", () => this.refreshAllLeaves())
        );
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => this.refreshAllLeaves())
        );

        this.app.workspace.onLayoutReady(() => this.refreshAllLeaves());
    }

    onunload() {
        this._urlCache.clear();
        document.querySelectorAll(".ob-banner-image").forEach((el) => el.remove());
        document.querySelectorAll(".ob-banner").forEach((el) => {
            el.classList.remove("ob-banner");
            this.cleanCssVars(el);
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.refreshAllLeaves();
    }

    cleanCssVars(el) {
        const vars = ["--ob-banner-height", "--ob-banner-max-width", "--ob-banner-x-position",
            "--ob-banner-y-position", "--ob-banner-fade", "--ob-banner-radius",
            "--ob-banner-gap", "--ob-banner-content-start"];
        vars.forEach((v) => el.style.removeProperty(v));
    }

    // ── Core rendering ──────────────────────────────────────────────────────

    refreshAllLeaves() {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view && leaf.view.getViewType() === "markdown") {
                this.processLeaf(leaf);
            }
        });
    }

    processLeaf(leaf) {
        const view = leaf.view;
        const file = view.file;
        if (!file) return;

        // Skip popover views if setting is disabled
        const isPopover = leaf.containerEl?.closest(".hover-popover") !== null;
        if (isPopover && !this.settings.showInPopover) {
            const viewContent = view.containerEl.querySelector(".view-content");
            if (viewContent) this.removeBanner(viewContent);
            return;
        }

        const viewContent = view.containerEl.querySelector(".view-content");
        if (!viewContent) return;

        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

        // Check show/hide flag
        if (frontmatter && frontmatter.hasOwnProperty(this.settings.showField) && frontmatter[this.settings.showField] === false) {
            this.removeBanner(viewContent);
            return;
        }

        // Get banner image field
        const rawValue = frontmatter ? frontmatter[this.settings.bannerField] : null;
        const imageName = extractLinkName(rawValue);

        if (!imageName) {
            this.removeBanner(viewContent);
            return;
        }

        // Resolve image
        const imageFile = resolveImage(this.app, imageName, file.path);
        if (!imageFile) {
            this.removeBanner(viewContent);
            return;
        }

        // Get resource URL
        let imageUrl = this._urlCache.get(imageFile.path);
        if (!imageUrl) {
            imageUrl = this.app.vault.getResourcePath(imageFile);
            this._urlCache.set(imageFile.path, imageUrl);
        }

        // Per-note Y position from frontmatter (overrides global)
        const perNoteY = frontmatter ? frontmatter[this.settings.yPositionField] : null;
        const yPosition = (typeof perNoteY === "number") ? perNoteY : this.settings.yPosition;

        viewContent.classList.add("ob-banner");
        this.applyStyles(viewContent, yPosition);

        // Inject banner into reading view only (not editing mode)
        this.ensureBanner(viewContent, ".markdown-reading-view .markdown-preview-view", ".markdown-preview-sizer", imageUrl, file);

        // Remove any stale banner from editing view
        const cmScroller = viewContent.querySelector(".markdown-source-view .cm-scroller");
        if (cmScroller) {
            const staleBanner = cmScroller.querySelector(":scope > .ob-banner-image");
            if (staleBanner) staleBanner.remove();
        }
    }

    ensureBanner(viewContent, scrollContainerSel, sizerSel, imageUrl, file) {
        const scrollContainer = viewContent.querySelector(scrollContainerSel);
        if (!scrollContainer) return;

        let bannerDiv = scrollContainer.querySelector(":scope > .ob-banner-image");

        // Don't touch the banner while repositioning (avoid clobbering drag state)
        if (bannerDiv && bannerDiv.classList.contains("ob-banner-repositioning")) return;

        if (!bannerDiv) {
            bannerDiv = createDiv({ cls: "ob-banner-image" });
            const sizer = scrollContainer.querySelector(`:scope > ${sizerSel.split(" ").pop()}`);
            if (sizer) {
                scrollContainer.insertBefore(bannerDiv, sizer);
            } else {
                scrollContainer.insertBefore(bannerDiv, scrollContainer.firstChild);
            }
        }

        bannerDiv.style.backgroundImage = `url('${imageUrl}')`;
        if (file) bannerDiv.dataset.filePath = file.path;

        // Measure parent padding so CSS can counter it for edge-to-edge display
        const cs = getComputedStyle(scrollContainer);
        bannerDiv.style.setProperty("--ob-banner-parent-pad-t", cs.paddingTop);
        bannerDiv.style.setProperty("--ob-banner-parent-pad-l", cs.paddingLeft);
        bannerDiv.style.setProperty("--ob-banner-parent-pad-r", cs.paddingRight);

        // Add reposition button if not already present
        this._ensureRepositionButton(bannerDiv, viewContent);
    }

    // ── Reposition UI ────────────────────────────────────────────────────────

    _ensureRepositionButton(bannerDiv, viewContent) {
        if (bannerDiv.querySelector(".ob-banner-reposition-btn")) return;

        // Wrapper for hover zone (sits on top of banner)
        const hoverZone = createDiv({ cls: "ob-banner-hover-zone" });

        const btn = createEl("button", { cls: "ob-banner-reposition-btn", text: "Reposition" });
        hoverZone.appendChild(btn);
        bannerDiv.appendChild(hoverZone);

        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            this._enterRepositionMode(bannerDiv, viewContent);
        });
    }

    _enterRepositionMode(bannerDiv, viewContent) {
        if (bannerDiv.classList.contains("ob-banner-repositioning")) return;

        // Read current Y position
        const currentVar = viewContent.style.getPropertyValue("--ob-banner-y-position");
        const startY = parseFloat(currentVar) || this.settings.yPosition;
        let currentY = startY;

        bannerDiv.classList.add("ob-banner-repositioning");

        // Hide the reposition button, show save/cancel bar
        const hoverZone = bannerDiv.querySelector(".ob-banner-hover-zone");
        if (hoverZone) hoverZone.style.display = "none";

        const toolbar = createDiv({ cls: "ob-banner-reposition-toolbar" });
        const saveBtn = createEl("button", { cls: "ob-banner-save-btn", text: "Save Position" });
        const cancelBtn = createEl("button", { cls: "ob-banner-cancel-btn", text: "Cancel" });
        toolbar.appendChild(saveBtn);
        toolbar.appendChild(cancelBtn);
        bannerDiv.appendChild(toolbar);

        // Drag tooltip
        const tooltip = createDiv({ cls: "ob-banner-drag-tooltip", text: "Drag to reposition" });
        bannerDiv.appendChild(tooltip);

        // ── Drag logic ──
        let isDragging = false;
        let dragStartMouseY = 0;
        let dragStartY = currentY;

        const onMouseDown = (e) => {
            if (e.target.closest(".ob-banner-reposition-toolbar")) return;
            e.preventDefault();
            isDragging = true;
            dragStartMouseY = e.clientY;
            dragStartY = currentY;
            bannerDiv.classList.add("ob-banner-dragging");
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const deltaY = e.clientY - dragStartMouseY;
            const bannerHeight = bannerDiv.offsetHeight;
            // Dragging down → decrease Y (show more of top), dragging up → increase Y
            const sensitivity = 100;
            currentY = Math.max(0, Math.min(100, dragStartY - (deltaY / bannerHeight) * sensitivity));
            viewContent.style.setProperty("--ob-banner-y-position", `${currentY}%`);
            tooltip.textContent = `Y: ${Math.round(currentY)}%`;
        };

        const onMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            bannerDiv.classList.remove("ob-banner-dragging");
            tooltip.textContent = "Drag to reposition";
        };

        bannerDiv.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);

        // ── Save ──
        saveBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            cleanup();
            const filePath = bannerDiv.dataset.filePath;
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file) {
                const yField = this.settings.yPositionField;
                const yVal = Math.round(currentY);
                this.app.fileManager.processFrontMatter(file, (fm) => {
                    fm[yField] = yVal;
                });
            }
        });

        // ── Cancel ──
        cancelBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            viewContent.style.setProperty("--ob-banner-y-position", `${startY}%`);
            cleanup();
        });

        const cleanup = () => {
            bannerDiv.classList.remove("ob-banner-repositioning", "ob-banner-dragging");
            bannerDiv.removeEventListener("mousedown", onMouseDown);
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            toolbar.remove();
            tooltip.remove();
            if (hoverZone) hoverZone.style.display = "";
        };
    }

    removeBanner(viewContent) {
        viewContent.classList.remove("ob-banner");
        viewContent.querySelectorAll(".ob-banner-image").forEach((el) => el.remove());
        this.cleanCssVars(viewContent);
    }

    applyStyles(viewContent, yPosition) {
        const s = this.settings;
        const yPos = (typeof yPosition === "number") ? yPosition : s.yPosition;
        const vars = {
            "--ob-banner-height": `${s.bannerHeight}px`,
            "--ob-banner-max-width": s.bannerMaxWidth <= 0 ? "unset" : `${s.bannerMaxWidth}px`,
            "--ob-banner-x-position": `${s.xPosition}%`,
            "--ob-banner-y-position": `${yPos}%`,
            "--ob-banner-fade": `${s.fade}%`,
            "--ob-banner-radius": `${s.borderRadius}px`,
            "--ob-banner-gap": `${s.bannerGap}px`,
            "--ob-banner-content-start": `${s.contentStartPosition}px`,
        };
        for (const [prop, val] of Object.entries(vars)) {
            viewContent.style.setProperty(prop, val);
        }
    }
}

// ── Settings tab ─────────────────────────────────────────────────────────────

class BannerSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /** Add a reset icon button to a setting */
    addResetButton(setting, key) {
        setting.addExtraButton((btn) =>
            btn.setIcon("reset").setTooltip("Reset to default")
                .onClick(async () => {
                    this.plugin.settings[key] = DEFAULT_SETTINGS[key];
                    await this.plugin.saveSettings();
                    this.display();
                })
        );
        return setting;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Frontmatter fields" });

        this.addResetButton(
            new Setting(containerEl)
                .setName("Banner image field")
                .setDesc("Frontmatter field name used to specify the banner image (wikilink format, e.g. [[image]]).")
                .addText((text) =>
                    text.setPlaceholder("art").setValue(this.plugin.settings.bannerField)
                        .onChange(async (value) => {
                            this.plugin.settings.bannerField = value.trim() || "art";
                            await this.plugin.saveSettings();
                        })
                ),
            "bannerField"
        );

        this.addResetButton(
            new Setting(containerEl)
                .setName("Show/hide field")
                .setDesc("Frontmatter field to toggle banner visibility (set to false to hide).")
                .addText((text) =>
                    text.setPlaceholder("banner").setValue(this.plugin.settings.showField)
                        .onChange(async (value) => {
                            this.plugin.settings.showField = value.trim() || "banner";
                            await this.plugin.saveSettings();
                        })
                ),
            "showField"
        );

        this.addResetButton(
            new Setting(containerEl)
                .setName("Y position field")
                .setDesc("Frontmatter field for per-note vertical position (saved by the Reposition button).")
                .addText((text) =>
                    text.setPlaceholder("banner-y").setValue(this.plugin.settings.yPositionField)
                        .onChange(async (value) => {
                            this.plugin.settings.yPositionField = value.trim() || "banner-y";
                            await this.plugin.saveSettings();
                        })
                ),
            "yPositionField"
        );

        containerEl.createEl("h2", { text: "Display" });

        this.addResetButton(
            new Setting(containerEl)
                .setName("Banner height")
                .setDesc("Height of the banner in pixels.")
                .addText((text) =>
                    text.setPlaceholder("350").setValue(String(this.plugin.settings.bannerHeight))
                        .onChange(async (value) => {
                            const n = parseInt(value, 10);
                            if (!isNaN(n) && n > 0) { this.plugin.settings.bannerHeight = n; await this.plugin.saveSettings(); }
                        })
                ),
            "bannerHeight"
        );

        this.addResetButton(
            new Setting(containerEl)
                .setName("Content start position")
                .setDesc("How far down (in px) the note content starts below the banner.")
                .addText((text) =>
                    text.setPlaceholder("355").setValue(String(this.plugin.settings.contentStartPosition))
                        .onChange(async (value) => {
                            const n = parseInt(value, 10);
                            if (!isNaN(n) && n >= 0) { this.plugin.settings.contentStartPosition = n; await this.plugin.saveSettings(); }
                        })
                ),
            "contentStartPosition"
        );

        this.addResetButton(
            new Setting(containerEl)
                .setName("Banner max width")
                .setDesc("Maximum width in pixels. Set to 0 for no limit.")
                .addText((text) =>
                    text.setPlaceholder("2560").setValue(String(this.plugin.settings.bannerMaxWidth))
                        .onChange(async (value) => {
                            const n = parseInt(value, 10);
                            if (!isNaN(n) && n >= 0) { this.plugin.settings.bannerMaxWidth = n; await this.plugin.saveSettings(); }
                        })
                ),
            "bannerMaxWidth"
        );

        this.addResetButton(
            new Setting(containerEl)
                .setName("Vertical position (Y)")
                .setDesc("0 = top, 100 = bottom.")
                .addSlider((slider) =>
                    slider.setLimits(0, 100, 1).setValue(this.plugin.settings.yPosition).setDynamicTooltip()
                        .onChange(async (value) => { this.plugin.settings.yPosition = value; await this.plugin.saveSettings(); })
                ),
            "yPosition"
        );

        this.addResetButton(
            new Setting(containerEl)
                .setName("Banner fade")
                .setDesc("-100 = full fade, 0 = no fade.")
                .addSlider((slider) =>
                    slider.setLimits(-100, 0, 1).setValue(this.plugin.settings.fade).setDynamicTooltip()
                        .onChange(async (value) => { this.plugin.settings.fade = value; await this.plugin.saveSettings(); })
                ),
            "fade"
        );

        this.addResetButton(
            new Setting(containerEl)
                .setName("Border radius")
                .setDesc("Border radius in pixels.")
                .addText((text) =>
                    text.setPlaceholder("0").setValue(String(this.plugin.settings.borderRadius))
                        .onChange(async (value) => {
                            const n = parseInt(value, 10);
                            if (!isNaN(n) && n >= 0) { this.plugin.settings.borderRadius = n; await this.plugin.saveSettings(); }
                        })
                ),
            "borderRadius"
        );

        this.addResetButton(
            new Setting(containerEl)
                .setName("Banner gap")
                .setDesc("Gap from window edges in pixels.")
                .addText((text) =>
                    text.setPlaceholder("0").setValue(String(this.plugin.settings.bannerGap))
                        .onChange(async (value) => {
                            const n = parseInt(value, 10);
                            if (!isNaN(n) && n >= 0) { this.plugin.settings.bannerGap = n; await this.plugin.saveSettings(); }
                        })
                ),
            "bannerGap"
        );

        containerEl.createEl("h2", { text: "Popover" });

        this.addResetButton(
            new Setting(containerEl)
                .setName("Show banner in popover preview")
                .setDesc("Display banners in hover popover previews.")
                .addToggle((toggle) =>
                    toggle.setValue(this.plugin.settings.showInPopover)
                        .onChange(async (value) => { this.plugin.settings.showInPopover = value; await this.plugin.saveSettings(); })
                ),
            "showInPopover"
        );

        // ── Quick reference ──
        containerEl.createEl("h2", { text: "Quick reference" });
        const showField = this.plugin.settings.showField;
        const yField = this.plugin.settings.yPositionField;
        const desc = containerEl.createEl("p", { cls: "setting-item-description" });
        desc.innerHTML = `To hide the banner on a specific note, add <code>${showField}: false</code> to its frontmatter.<br>` +
            `To set a per-note vertical position, use the <strong>Reposition</strong> button on the banner, or manually add <code>${yField}: 0-100</code> to frontmatter.`;
    }
}

module.exports = BannerPlugin;
