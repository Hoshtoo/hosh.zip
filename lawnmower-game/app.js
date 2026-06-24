(function () {
    "use strict";

    var SAVE_KEY = "lawnmower-v2-save";

    var width = 500;
    var height = 500;

    var money = 0;
    var totalMoney = 0;

    var canvas;
    var ctx;

    var fields = [];

    var nextMulch = 0;
    var tileSizes = [50, 25, 20, 10, 5, 4, 2, 1];

    var maxGrowth = 15;

    var mulch = 0;
    var permanentLevels = {};
    var discoveredStages = { Grass: true };
    var unlockedThisRun = { Grass: true };

    var activeField;
    var growthBonus = 0;

    var growthBasePrice = 10;
    var speedBasePrice = 50;
    var sizeBasePrice = 75;
    var tileBasePrice = 150;
    var tickBasePrice = 5;

    var growthRateMultiplier = 1.2;
    var tickBaseMultiplier = 1.2;
    var mowerRateMultiplier = 2.5;
    var mowerSizeMultiplier = 1.5;
    var tileSizeMultiplier = 3.5;
    var maxMachineSize = 15;

    var currentlyPrestiging = false;
    var saveTimeout = null;
    var uiDirty = false;

    var dom = {};

    var MULCH_UPGRADE_DEFS = [
        {
            id: "harvestBoost",
            displayName: "Harvest Boost",
            baseCost: 5,
            costMult: 1.8,
            maxLevel: null,
            buttonId: "mulchHarvestBoost",
            textId: "textHarvestBoost",
            canBuy: function () { return true; },
            effectLabel: function (level) {
                return "+" + (level * 3) + "% value (Lv " + level + ")";
            }
        },
        {
            id: "headStart",
            displayName: "Head Start",
            baseCost: 10,
            costMult: 2.0,
            maxLevel: null,
            buttonId: "mulchHeadStart",
            textId: "textHeadStart",
            canBuy: function () { return true; },
            effectLabel: function (level) {
                return "+" + level + " starting speed (Lv " + level + ")";
            }
        },
        {
            id: "greenThumb",
            displayName: "Green Thumb",
            baseCost: 8,
            costMult: 1.75,
            maxLevel: null,
            buttonId: "mulchGreenThumb",
            textId: "textGreenThumb",
            canBuy: function () { return true; },
            effectLabel: function (level) {
                return "+" + level + " growth/tick (Lv " + level + ")";
            }
        },
        {
            id: "efficiency",
            displayName: "Efficiency",
            baseCost: 15,
            costMult: 2.2,
            maxLevel: 5,
            buttonId: "mulchEfficiency",
            textId: "textEfficiency",
            canBuy: function (areaName) {
                return getPermanentLevel(areaName, "efficiency") < 5;
            },
            effectLabel: function (level) {
                return "-" + (level * 2) + "% upgrade costs (Lv " + level + ")";
            }
        }
    ];

    function getMaxMachineSize(field) {
        var gridTiles = width / tileSizes[field.tileSize];
        return Math.min(maxMachineSize, gridTiles);
    }

    function isStageDiscovered(field) {
        return field.name === "Grass" || !!discoveredStages[field.name];
    }

    function getStageDisplayName(field) {
        return isStageDiscovered(field) ? field.name : "???";
    }

    function isFieldUnlocked(field) {
        return field.name === "Grass" || !!unlockedThisRun[field.name] || field.unlockedThisRun;
    }

    function canUnlockField(field) {
        return !isFieldUnlocked(field) && field.unlockPrice >= 0;
    }

    function markFieldUnlocked(field) {
        field.unlockedThisRun = true;
        unlockedThisRun[field.name] = true;
        discoveredStages[field.name] = true;
    }

    function resetRunUnlocks() {
        unlockedThisRun = { Grass: true };
        for (var i = 0; i < fields.length; i++) {
            fields[i].unlockedThisRun = fields[i].name === "Grass";
        }
    }

    function getPermanentLevel(areaName, upgradeId) {
        if (!permanentLevels[areaName]) {
            return 0;
        }
        return permanentLevels[areaName][upgradeId] || 0;
    }

    function getMulchCost(areaName, def, level) {
        var field = getField(areaName);
        var stageMult = field ? field.initialBuff : 1;
        return Math.floor(def.baseCost * stageMult * Math.pow(def.costMult, level));
    }

    function getHarvestMultiplier(areaName) {
        return 1 + 0.03 * getPermanentLevel(areaName, "harvestBoost");
    }

    function getEfficiencyFactor(areaName) {
        return Math.pow(0.98, getPermanentLevel(areaName, "efficiency"));
    }

    function advanceUpgradePrice(currentPrice, multiplier, efficiencyFactor) {
        var scaled = currentPrice * multiplier * efficiencyFactor;
        var nextPrice = Math.floor(scaled);
        if (nextPrice <= currentPrice) {
            nextPrice = currentPrice + 1;
        }
        return nextPrice;
    }

    function scheduleSave() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        saveTimeout = setTimeout(saveProgress, 2000);
    }

    function saveProgress() {
        saveTimeout = null;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify({
                mulch: mulch,
                permanentLevels: permanentLevels,
                discoveredStages: discoveredStages
            }));
        } catch (e) { /* ignore quota errors */ }
    }

    function saveProgressNow() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify({
                mulch: mulch,
                permanentLevels: permanentLevels,
                discoveredStages: discoveredStages
            }));
        } catch (e) { /* ignore */ }
    }

    function loadProgress() {
        try {
            var raw = localStorage.getItem(SAVE_KEY);
            if (!raw) {
                return;
            }
            var data = JSON.parse(raw);
            if (typeof data.mulch === "number") {
                mulch = data.mulch;
            }
            if (data.permanentLevels && typeof data.permanentLevels === "object") {
                permanentLevels = data.permanentLevels;
            }
            if (data.discoveredStages && typeof data.discoveredStages === "object") {
                discoveredStages = data.discoveredStages;
            }
            for (var stageName in permanentLevels) {
                if (permanentLevels.hasOwnProperty(stageName)) {
                    discoveredStages[stageName] = true;
                }
            }
            discoveredStages.Grass = true;
        } catch (e) { /* ignore corrupt save */ }
    }

    function buyMulchUpgrade(upgradeId) {
        var areaName = activeField.name;
        var def = getMulchDef(upgradeId);
        if (!def) {
            return;
        }
        var level = getPermanentLevel(areaName, upgradeId);
        if (def.maxLevel !== null && level >= def.maxLevel) {
            return;
        }
        var cost = getMulchCost(areaName, def, level);
        if (mulch < cost) {
            return;
        }
        mulch -= cost;
        if (!permanentLevels[areaName]) {
            permanentLevels[areaName] = {};
        }
        permanentLevels[areaName][upgradeId] = level + 1;
        activeField.applyPermanentBonuses();
        saveProgressNow();
        updateText();
        updatePrestigeValues();
    }

    function getMulchDef(upgradeId) {
        for (var i = 0; i < MULCH_UPGRADE_DEFS.length; i++) {
            if (MULCH_UPGRADE_DEFS[i].id === upgradeId) {
                return MULCH_UPGRADE_DEFS[i];
            }
        }
        return null;
    }

    function Area(name, multiplierBuff, initialBuff, baseColor, grownColor, machineColor, unlockPrice, message, value, machineName, hmm) {
        this.baseColor = baseColor;
        this.grownColor = grownColor;
        this.message = message;
        this.whyDoIDoThis = hmm;
        this.initialBuff = initialBuff;
        this.name = name;
        this.machineName = machineName;
        this.superExtra = 0;
        this.superTicks = 0;
        this.lastTick = Date.now();
        this.growthAmount = 4;
        this.machineX = 0;
        this.machineY = 0;
        this.value = value;
        this.machineWidth = 1;
        this.machineHeight = 1;
        this.machineSpeed = 1;
        this.goingUp = false;
        this.machineColor = machineColor;
        this.totalMowed = 0;
        this.field = [];
        this.tileSize = 0;
        this.tickRate = 1000;
        this.unlockPrice = unlockPrice;
        this.unlockedThisRun = false;
        this.needsRedraw = false;

        var self = this;
        this.upgrades = [
            new Upgrade("machineSpeed", speedBasePrice * initialBuff, mowerRateMultiplier + multiplierBuff, function () { self.machineSpeed++; }, "%tpt% tiles/tick", "%name% Speed", function () { return self.machineSpeed < 20; }),
            new Upgrade("machineSize", sizeBasePrice * initialBuff, mowerSizeMultiplier + multiplierBuff, function () {
                if (self.machineWidth === self.machineHeight) {
                    self.machineWidth++;
                } else {
                    self.machineHeight++;
                }
                self.machineX = 0;
                self.machineY = 0;
            }, "%w%x%h%", "%name% Size", function () {
                var cap = getMaxMachineSize(self);
                return self.machineWidth < cap || self.machineHeight < cap;
            }),
            new Upgrade("tileSize", tileBasePrice * initialBuff, tileSizeMultiplier + multiplierBuff, function () {
                self.tileSize = Math.min(self.tileSize + 1, tileSizes.length - 1);
                self.regenerate();
            }, "%sz%x%sz%", "Tile Size", function () { return self.tileSize < tileSizes.length - 1; }),
            new Upgrade("growthRate", growthBasePrice * initialBuff, growthRateMultiplier + multiplierBuff, function () { self.growthAmount += 2; }, "%gr% growth/tick", "Growth Rate", function () { return self.growthAmount < 60; }),
            new Upgrade("tickRate", tickBasePrice * initialBuff, tickBaseMultiplier + multiplierBuff, function () {
                self.tickRate = Math.max(1, Math.floor(self.tickRate * 0.9));
            }, "%ms% ms", "Tick Rate", function () { return self.tickRate > 4; })
        ];

        this.applyPermanentBonuses = function () {
            var hs = getPermanentLevel(self.name, "headStart");
            var gt = getPermanentLevel(self.name, "greenThumb");
            self.machineSpeed = Math.max(self.machineSpeed, 1 + hs);
            self.growthAmount = Math.max(self.growthAmount, 4 + gt);
        };

        this.applyPermanentBonuses();

        this.generateField = function (drawToCanvas) {
            var cols = width / tileSizes[this.tileSize];
            var rows = height / tileSizes[this.tileSize];
            this.field = [];
            for (var i = 0; i < cols; i++) {
                this.field.push([]);
                for (var j = 0; j < rows; j++) {
                    this.field[i].push(Math.floor(Math.random() * maxGrowth));
                    if (drawToCanvas && activeField === this) {
                        updateTile(this, i, j);
                    }
                }
            }
            this.lastTick = Date.now();
            this.needsRedraw = !drawToCanvas;
        };

        this.unlockField = function () {
            if (!canUnlockField(self) || money < this.unlockPrice) {
                return false;
            }
            money -= this.unlockPrice;
            markFieldUnlocked(self);
            if (!this.field.length) {
                this.generateField(false);
            }
            uiDirty = true;
            switchToField(self);
            updateStageMenu();
            updateText();
            saveProgressNow();
            return true;
        };

        this.getUpgradeText = function (upgrade) {
            return upgrade.displayText
                .replace("%tpt%", this.machineSpeed)
                .replace("%w%", this.machineWidth)
                .replace("%h%", this.machineHeight)
                .replace(/%sz%/g, width / tileSizes[this.tileSize])
                .replace("%ms%", this.tickRate)
                .replace("%gr%", this.growthAmount);
        };

        this.regenerate = function () {
            this.generateField(activeField === this);
        };

        this.machineTick = function () {
            var moneyEarnedThisTick = 0;
            var mowedThisTick = 0;
            var harvestMult = getHarvestMultiplier(this.name);
            var valueMult = (1 + mulch / 100) * harvestMult;
            var isActive = activeField === this;
            var tilePx = tileSizes[this.tileSize];

            for (var i = 0; i < this.machineSpeed; i++) {
                var cX = this.machineX;
                var cY = this.machineY;

                for (var x = 0; x < this.machineWidth; x++) {
                    for (var y = 0; y < this.machineHeight; y++) {
                        var tX = x + cX;
                        var tY = y + cY;
                        if (this.field[tX][tY] >= 5) {
                            this.field[tX][tY] = 0;
                            var payout = this.value * (this.superTicks > 0 ? 5 : 1) * valueMult;
                            money += payout;
                            totalMoney += payout;
                            moneyEarnedThisTick += payout;
                            this.superTicks = Math.max(0, this.superTicks - 1);
                            this.totalMowed++;
                            mowedThisTick++;
                        }
                        if (isActive) {
                            updateTile(this, tX, tY);
                        }
                    }
                }

                if (this.goingUp) {
                    if (this.machineY > 0) {
                        this.machineY--;
                    } else if (this.machineX >= width / tilePx - this.machineWidth) {
                        this.goingUp = false;
                        this.machineX = 0;
                        this.machineY = 0;
                    } else {
                        this.machineX = Math.min(this.machineX + this.machineWidth, width / tilePx - this.machineWidth);
                        this.goingUp = false;
                    }
                } else if (this.machineY < height / tilePx - this.machineHeight) {
                    this.machineY++;
                } else if (this.machineX >= width / tilePx - this.machineWidth) {
                    this.goingUp = false;
                    this.machineX = 0;
                    this.machineY = 0;
                } else {
                    this.machineX = Math.min(this.machineX + this.machineWidth, width / tilePx - this.machineWidth);
                    this.goingUp = true;
                }

                if (isActive) {
                    ctx.fillStyle = this.machineColor;
                    ctx.fillRect(
                        this.machineX * tilePx,
                        this.machineY * tilePx,
                        tilePx * this.machineWidth,
                        tilePx * this.machineHeight
                    );
                }
            }

            if (moneyEarnedThisTick > 0 || mowedThisTick > 0) {
                uiDirty = true;
            }
        };

        this.growthTick = function () {
            var cols = width / tileSizes[this.tileSize];
            var rows = height / tileSizes[this.tileSize];
            var x = Math.floor(Math.random() * cols);
            var y = Math.floor(Math.random() * rows);
            if (this.field[x][y] < maxGrowth) {
                this.field[x][y] = Math.min(maxGrowth, this.field[x][y] + 1 + growthBonus);
            }
            if (activeField === this) {
                updateTile(this, x, y);
            }
        };
    }

    function Upgrade(name, price, multiplier, onBuy, displayText, displayName, canBuy) {
        this.name = name;
        this.displayName = displayName;
        this.basePrice = price;
        this.price = price;
        this.baseMultiplier = multiplier;
        this.multiplier = multiplier;
        this.displayText = displayText;
        this.canBuy = canBuy;
        this.buyUpgrade = function () {
            if (!canBuy() || money < this.price) {
                return;
            }
            money -= this.price;
            onBuy();
            this.price = advanceUpgradePrice(
                this.price,
                this.multiplier,
                getEfficiencyFactor(activeField.name)
            );
            uiDirty = true;
            updateText();
        };
    }

    function upgrade(name) {
        getUpgrade(activeField, name).buyUpgrade();
    }

    function getField(name) {
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].name === name) {
                return fields[i];
            }
        }
        return fields[0];
    }

    function getUpgrade(field, name) {
        for (var i = 0; i < field.upgrades.length; i++) {
            if (field.upgrades[i].name === name) {
                return field.upgrades[i];
            }
        }
        return field.upgrades[0];
    }

    function redrawField(field) {
        if (!field.field.length) {
            return;
        }
        ctx.clearRect(0, 0, width, height);
        for (var x = 0; x < field.field.length; x++) {
            for (var y = 0; y < field.field[0].length; y++) {
                updateTile(field, x, y);
            }
        }
        ctx.fillStyle = field.machineColor;
        var tilePx = tileSizes[field.tileSize];
        ctx.fillRect(
            field.machineX * tilePx,
            field.machineY * tilePx,
            tilePx * field.machineWidth,
            tilePx * field.machineHeight
        );
        field.needsRedraw = false;
    }

    function switchToField(field) {
        activeField = field;
        if (!field.field.length) {
            field.generateField(true);
        } else {
            redrawField(field);
        }
        updateText();
        dom.desc.textContent = isStageDiscovered(field) ? field.whyDoIDoThis : "???";
        dom.stageName.textContent = getStageDisplayName(field) + " Field";
        updateStageMenu();
    }

    function handleStageSelect(field) {
        if (isFieldUnlocked(field)) {
            switchToField(field);
            return;
        }
        if (money >= field.unlockPrice) {
            field.unlockField();
        }
    }

    function buildStageMenu() {
        if (!dom.stageMenu) {
            return;
        }
        dom.stageMenu.innerHTML = "";
        for (var i = 0; i < fields.length; i++) {
            (function (field) {
                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "stage-item";
                btn.addEventListener("click", function () {
                    handleStageSelect(field);
                });

                var nameEl = document.createElement("span");
                nameEl.className = "stage-item-name";
                nameEl.textContent = getStageDisplayName(field);

                var metaEl = document.createElement("span");
                metaEl.className = "stage-item-meta";

                btn.appendChild(nameEl);
                btn.appendChild(metaEl);
                dom.stageMenu.appendChild(btn);
            })(fields[i]);
        }
        updateStageMenu();
    }

    function updateStageMenu() {
        if (!dom.stageMenu) {
            return;
        }
        var buttons = dom.stageMenu.querySelectorAll(".stage-item");
        for (var i = 0; i < fields.length && i < buttons.length; i++) {
            var field = fields[i];
            var btn = buttons[i];
            var nameEl = btn.querySelector(".stage-item-name");
            var metaEl = btn.querySelector(".stage-item-meta");

            nameEl.textContent = getStageDisplayName(field);
            btn.classList.remove("is-active", "is-locked");

            if (activeField === field) {
                btn.classList.add("is-active");
                metaEl.textContent = "Active";
                btn.disabled = false;
            } else if (isFieldUnlocked(field)) {
                metaEl.textContent = "Visit";
                btn.disabled = false;
            } else {
                btn.classList.add("is-locked");
                if (field.unlockPrice === 0) {
                    metaEl.textContent = "Free";
                } else {
                    metaEl.textContent = "$" + formatNumber(field.unlockPrice);
                }
                btn.disabled = money < field.unlockPrice;
            }
        }
    }

    function formatNumber(n) {
        return Math.floor(n).toLocaleString();
    }

    function updateText() {
        var field = activeField;
        for (var j = 0; j < field.upgrades.length; j++) {
            var up = field.upgrades[j];
            var label = up.canBuy()
                ? "Upgrade " + up.displayName.replace("%name%", isStageDiscovered(field) ? field.machineName : "???") + " — $" + formatNumber(up.price)
                : "MAXED";
            dom["upgrade" + up.name].textContent = label;
            dom["upgrade" + up.name].disabled = !up.canBuy() || money < up.price;
            dom["text" + up.name].textContent = field.getUpgradeText(up);
        }

        dom.totalMowed.textContent = (isStageDiscovered(field) ? field.message : "Total ??? Processed: ") + field.totalMowed;

        for (var k = 0; k < MULCH_UPGRADE_DEFS.length; k++) {
            var def = MULCH_UPGRADE_DEFS[k];
            var level = getPermanentLevel(field.name, def.id);
            var maxed = def.maxLevel !== null && level >= def.maxLevel;
            var cost = getMulchCost(field.name, def, level);
            var btn = dom[def.buttonId];
            var txt = dom[def.textId];
            if (maxed) {
                btn.textContent = def.displayName + " — MAXED";
                btn.disabled = true;
            } else {
                btn.textContent = def.displayName + " — " + formatNumber(cost) + " mulch";
                btn.disabled = mulch < cost;
            }
            txt.textContent = def.effectLabel(level);
        }

        updateStageMenu();
        flushUI();
    }

    function flushUI() {
        dom.money.textContent = "$" + formatNumber(money);
        if (activeField.superTicks > 0) {
            dom.superTicks.textContent = "Super Ticks: " + activeField.superTicks;
        } else {
            dom.superTicks.textContent = "";
        }
        dom.totalMowed.textContent = (isStageDiscovered(activeField) ? activeField.message : "Total ??? Processed: ") + activeField.totalMowed;
        updateStageMenu();
        uiDirty = false;
    }

    function runFieldTick(field, now) {
        var elapsed = now - field.lastTick;
        if (elapsed < field.tickRate) {
            return;
        }

        var ticksToRun = Math.min(Math.floor(elapsed / field.tickRate), 5);
        var consumed = ticksToRun * field.tickRate;
        field.lastTick += consumed;
        field.superExtra += elapsed - consumed;

        if (field.superExtra > field.tickRate * 5) {
            field.superTicks += Math.floor(field.superExtra / 5 / field.tickRate);
            field.superExtra %= field.tickRate * 5;
        }

        for (var t = 0; t < ticksToRun; t++) {
            for (var g = 0; g < field.growthAmount; g++) {
                field.growthTick();
            }
            field.machineTick();
        }

        if (ticksToRun > 0) {
            uiDirty = true;
        }
    }

    function gameLoop() {
        if (!currentlyPrestiging) {
            var now = Date.now();
            for (var i = 0; i < fields.length; i++) {
                if (isFieldUnlocked(fields[i])) {
                    runFieldTick(fields[i], now);
                }
            }
            if (uiDirty) {
                flushUI();
            }
        }
        requestAnimationFrame(gameLoop);
    }

    function addFields() {
        fields.push(new Area("Grass", 0, 1, [0, 210, 0], [0, 130, 0], "rgb(255,0,0)", 0, "Total Grass Mowed: ", 1, "Lawnmower", "Wow this lawn grows fast."));
        fields.push(new Area("Dirt", 0.15, 10, [175, 175, 175], [122, 96, 0], "rgb(68, 130, 206)", 100000, "Total Dirt Vacuumed: ", 5, "Vacuum", "Vroom, vroom"));
        fields.push(new Area("Weed", 0.25, 50, [239, 233, 112], [145, 233, 124], "rgb(255,127,0)", 1000000, "Total Weeds Whacked: ", 20, "Weed Whacker", "Good thing you don't need to keep replacing the trimming stuff."));
        fields.push(new Area("Pumpkin", 0.35, 100, [181, 155, 105], [255, 188, 61], "rgb(119, 119, 119)", 10000000, "Total Pumpkins Thwacked: ", 50, "Harvester", "For when you can't find the hippogriff."));
        fields.push(new Area("Tree", 0.45, 500, [122, 81, 0], [54, 109, 0], "rgb(97, 175, 191)", 100000000, "Total Trees Chopped: ", 100, "Chainsaw", "No, it's only for trees."));
        fields.push(new Area("Fire", 0.55, 1000, [255, 0, 0], [255, 255, 0], "rgb(0,0,255)", 1000000000, "Total Fires Extinguished: ", 200, "Wave", "I'm impressed that you know how to create a wave out of thin air."));
        fields.push(new Area("Stone", 0.65, 5000, [255, 255, 255], [124, 124, 124], "rgb(122, 73, 33)", 10000000000, "Total Stone Mined: ", 500, "Wooden Pickaxe", "I swear this one's not a reference to anything."));
        fields.push(new Area("Iron", 0.75, 10000, [124, 124, 124], [221, 206, 193], "rgb(100, 100, 100)", 100000000000, "Total Iron Mined: ", 1000, "Stone Pickaxe", "Nor is this one."));
        fields.push(new Area("Diamond", 0.85, 50000, [124, 124, 124], [124, 239, 228], "rgb(221, 206, 193)", 1000000000000, "Total Diamonds Mined: ", 2000, "Iron Pickaxe", "Ok - last one I swear."));
        fields.push(new Area("Gold", 0.95, 100000, [138, 202, 216], [211, 176, 0], "rgb(143, 158, 139)", 10000000000000, "Total Gold Panned: ", 5000, "Pan", "There's no rush ;)"));
        fields.push(new Area("People", 0.65, 5000, [255, 67, 50], [255, 211, 168], "rgb(100, 100, 100)", 100000000000000, "Total People Killed: ", 10000, "Terminator", "I'll be back"));
    }

    function cacheDom() {
        dom.money = document.getElementById("money");
        dom.mulch = document.getElementById("mulch");
        dom.valueBonus = document.getElementById("valueBonus");
        dom.growthBonus = document.getElementById("growthBonus");
        dom.superTicks = document.getElementById("superTicks");
        dom.totalMowed = document.getElementById("totalMowed");
        dom.desc = document.getElementById("desc");
        dom.stageName = document.getElementById("stageName");
        dom.stageMenu = document.getElementById("stageMenu");
        dom.prestigeButton = document.getElementById("prestigeButton");
        dom.upgradetickRate = document.getElementById("upgradetickRate");
        dom.upgradegrowthRate = document.getElementById("upgradegrowthRate");
        dom.upgrademachineSpeed = document.getElementById("upgrademachineSpeed");
        dom.upgrademachineSize = document.getElementById("upgrademachineSize");
        dom.upgradetileSize = document.getElementById("upgradetileSize");
        dom.texttickRate = document.getElementById("texttickRate");
        dom.textgrowthRate = document.getElementById("textgrowthRate");
        dom.textmachineSpeed = document.getElementById("textmachineSpeed");
        dom.textmachineSize = document.getElementById("textmachineSize");
        dom.texttileSize = document.getElementById("texttileSize");
        dom.mulchHarvestBoost = document.getElementById("mulchHarvestBoost");
        dom.mulchHeadStart = document.getElementById("mulchHeadStart");
        dom.mulchGreenThumb = document.getElementById("mulchGreenThumb");
        dom.mulchEfficiency = document.getElementById("mulchEfficiency");
        dom.textHarvestBoost = document.getElementById("textHarvestBoost");
        dom.textHeadStart = document.getElementById("textHeadStart");
        dom.textGreenThumb = document.getElementById("textGreenThumb");
        dom.textEfficiency = document.getElementById("textEfficiency");
    }

    function bindEvents() {
        dom.prestigeButton.addEventListener("click", attemptPrestige);

        dom.upgradetickRate.addEventListener("click", function () { upgrade("tickRate"); });
        dom.upgradegrowthRate.addEventListener("click", function () { upgrade("growthRate"); });
        dom.upgrademachineSpeed.addEventListener("click", function () { upgrade("machineSpeed"); });
        dom.upgrademachineSize.addEventListener("click", function () { upgrade("machineSize"); });
        dom.upgradetileSize.addEventListener("click", function () { upgrade("tileSize"); });

        dom.mulchHarvestBoost.addEventListener("click", function () { buyMulchUpgrade("harvestBoost"); });
        dom.mulchHeadStart.addEventListener("click", function () { buyMulchUpgrade("headStart"); });
        dom.mulchGreenThumb.addEventListener("click", function () { buyMulchUpgrade("greenThumb"); });
        dom.mulchEfficiency.addEventListener("click", function () { buyMulchUpgrade("efficiency"); });
    }

    function setup() {
        canvas = document.getElementById("lawn");
        ctx = canvas.getContext("2d");

        cacheDom();
        bindEvents();
        loadProgress();

        addFields();
        fields[0].unlockedThisRun = true;
        activeField = fields[0];
        activeField.generateField(true);

        buildStageMenu();
        updateText();
        updatePrestigeValues();
        requestAnimationFrame(gameLoop);
        setInterval(updatePrestigeValues, 500);
    }

    function updatePrestigeValues() {
        calculateGrowthBonus();
        nextMulch = Math.floor(Math.max(0, Math.pow(Math.max(0, totalMoney / 10 - 7500), 0.575) - mulch));
        dom.mulch.textContent = formatNumber(mulch);
        dom.prestigeButton.textContent = "Prestige for " + formatNumber(nextMulch) + " Mulch";
        dom.prestigeButton.disabled = nextMulch <= 0;
        dom.valueBonus.textContent = formatNumber(mulch) + "%";
        dom.growthBonus.textContent = (growthBonus + 1) + "x";

        for (var k = 0; k < MULCH_UPGRADE_DEFS.length; k++) {
            var def = MULCH_UPGRADE_DEFS[k];
            var level = getPermanentLevel(activeField.name, def.id);
            var maxed = def.maxLevel !== null && level >= def.maxLevel;
            var cost = getMulchCost(activeField.name, def, level);
            var btn = dom[def.buttonId];
            if (maxed) {
                btn.disabled = true;
            } else {
                btn.disabled = mulch < cost;
            }
        }

        for (var j = 0; j < activeField.upgrades.length; j++) {
            var up = activeField.upgrades[j];
            dom["upgrade" + up.name].disabled = !up.canBuy() || money < up.price;
        }
        updateStageMenu();
    }

    function calculateGrowthBonus() {
        if (mulch <= 0) {
            growthBonus = 0;
            return;
        }
        // growthBonus + 1 === digit count of mulch (e.g. 100–999 mulch → 3x)
        growthBonus = Math.floor(Math.log10(mulch));
    }

    function attemptPrestige() {
        if (nextMulch > 0) {
            currentlyPrestiging = true;
            dom.prestigeButton.disabled = true;
            dom.prestigeButton.textContent = "Prestiging...";
            setTimeout(reset, 2000);
        }
    }

    function reset() {
        mulch += nextMulch;
        money = 0;
        totalMoney = 0;

        fields = [];
        addFields();
        resetRunUnlocks();
        activeField = fields[0];
        activeField.generateField(true);
        currentlyPrestiging = false;

        saveProgressNow();
        buildStageMenu();
        updateText();
        updatePrestigeValues();
    }

    function updateTile(field, x, y) {
        var ratio = field.field[x][y] / maxGrowth;
        var r = field.baseColor[0] + Math.round(ratio * (field.grownColor[0] - field.baseColor[0]));
        var g = field.baseColor[1] + Math.round(ratio * (field.grownColor[1] - field.baseColor[1]));
        var b = field.baseColor[2] + Math.round(ratio * (field.grownColor[2] - field.baseColor[2]));

        var tilePx = tileSizes[field.tileSize];
        var px = x * tilePx;
        var py = y * tilePx;

        ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
        ctx.fillRect(px, py, tilePx, tilePx);
    }

    window.addEventListener("DOMContentLoaded", setup);
})();
