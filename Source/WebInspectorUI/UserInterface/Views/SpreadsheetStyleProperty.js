/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

WI.SpreadsheetStyleProperty = class SpreadsheetStyleProperty extends WI.Object
{
    constructor(delegate, property, options = {})
    {
        super();

        console.assert(property instanceof WI.CSSProperty);

        this._delegate = delegate || null;
        this._property = property;
        this._readOnly = options.readOnly || false;
        this._element = document.createElement("div");

        this._contentElement = null;
        this._nameElement = null;
        this._valueElement = null;
        this._jumpToEffectivePropertyButton = null;

        this._nameTextField = null;
        this._valueTextField = null;

        this._selected = false;
        this._hasInvalidVariableValue = false;

        this.update();
        property.addEventListener(WI.CSSProperty.Event.OverriddenStatusChanged, this.updateStatus, this);
        property.addEventListener(WI.CSSProperty.Event.Changed, this.updateStatus, this);

        if (!this._readOnly) {
            this._element.tabIndex = -1;
            property.addEventListener(WI.CSSProperty.Event.ModifiedChanged, this.updateStatus, this);

            this._element.addEventListener("blur", (event) => {
                // Keep selection after tabbing out of Web Inspector window and back.
                if (document.activeElement === this._element)
                    return;

                if (this._delegate.spreadsheetStylePropertyBlur)
                    this._delegate.spreadsheetStylePropertyBlur(event, this);
            });

            this._element.addEventListener("mouseenter", (event) => {
                if (this._delegate.spreadsheetStylePropertyMouseEnter)
                    this._delegate.spreadsheetStylePropertyMouseEnter(event, this);
            });

            new WI.KeyboardShortcut(WI.KeyboardShortcut.Modifier.CommandOrControl, WI.KeyboardShortcut.Key.Slash, () => {
                this._toggle();
                this._select();
            }, this._element);
        }
    }

    // Public

    get element() { return this._element; }
    get property() { return this._property; }
    get enabled() { return this._property.enabled; }

    set index(index)
    {
        this._element.dataset.propertyIndex = index;
    }

    get selected()
    {
        return this._selected;
    }

    set selected(value)
    {
        if (value === this._selected)
            return;

        this._selected = value;
        this.updateStatus();
    }

    startEditingName()
    {
        if (!this._nameTextField)
            return;

        this._nameTextField.startEditing();
    }

    startEditingValue()
    {
        if (!this._valueTextField)
            return;

        this._valueTextField.startEditing();
    }

    detached()
    {
        if (this._nameTextField)
            this._nameTextField.detached();

        if (this._valueTextField)
            this._valueTextField.detached();
    }

    hidden()
    {
        if (this._nameTextField && this._nameTextField.editing)
            this._nameTextField.element.blur();
        else if (this._valueTextField && this._valueTextField.editing)
            this._valueTextField.element.blur();
    }

    remove(replacement = null)
    {
        if (this._delegate && typeof this._delegate.spreadsheetStylePropertyWillRemove === "function")
            this._delegate.spreadsheetStylePropertyWillRemove(this);

        this.element.remove();

        if (replacement)
            this._property.replaceWithText(replacement);
        else
            this._property.remove();

        this.detached();
    }

    update()
    {
        this.element.removeChildren();

        if (this._isEditable()) {
            this._checkboxElement = this.element.appendChild(document.createElement("input"));
            this._checkboxElement.classList.add("property-toggle");
            this._checkboxElement.type = "checkbox";
            this._checkboxElement.checked = this._property.enabled;
            this._checkboxElement.tabIndex = -1;
            this._checkboxElement.addEventListener("click", (event) => {
                event.stopPropagation();
                this._toggle();
                console.assert(this._checkboxElement.checked === this._property.enabled);
            });
        }

        this._contentElement = this.element.appendChild(document.createElement("span"));
        this._contentElement.className = "content";

        if (!this._property.enabled)
            this._contentElement.append("/* ");

        this._nameElement = this._contentElement.appendChild(document.createElement("span"));
        this._nameElement.classList.add("name");
        this._nameElement.textContent = this._property.name;

        let colonElement = this._contentElement.appendChild(document.createElement("span"));
        colonElement.classList.add("colon");
        colonElement.textContent = ": ";

        let valueContainer = this._contentElement.appendChild(document.createElement("span"));
        valueContainer.className = "value-container";

        this._valueElement = valueContainer.appendChild(document.createElement("span"));
        this._valueElement.classList.add("value");
        this._renderValue(this._property.rawValue);

        if (this._isEditable() && this._property.enabled) {
            this._nameElement.tabIndex = 0;
            this._nameElement.addEventListener("beforeinput", this._handleNameBeforeInput.bind(this));
            this._nameElement.addEventListener("paste", this._handleNamePaste.bind(this));

            this._nameTextField = new WI.SpreadsheetTextField(this, this._nameElement, this._nameCompletionDataProvider.bind(this));

            this._valueElement.tabIndex = 0;
            this._valueElement.addEventListener("beforeinput", this._handleValueBeforeInput.bind(this));

            this._valueTextField = new WI.SpreadsheetTextField(this, this._valueElement, this._valueCompletionDataProvider.bind(this));
        }

        if (this._isEditable()) {
            this._setupJumpToSymbol(this._nameElement);
            this._setupJumpToSymbol(this._valueElement);
        }

        let semicolonElement = valueContainer.appendChild(document.createElement("span"));
        semicolonElement.classList.add("semicolon");
        semicolonElement.textContent = ";";

        if (this._property.enabled) {
            this._warningElement = this.element.appendChild(document.createElement("span"));
            this._warningElement.className = "warning";
        } else
            this._contentElement.append(" */");

        if (!this._property.implicit && this._property.ownerStyle.type === WI.CSSStyleDeclaration.Type.Computed && !this._property.isShorthand) {
            let effectiveProperty = this._property.ownerStyle.nodeStyles.effectivePropertyForName(this._property.name);
            if (effectiveProperty && !effectiveProperty.styleSheetTextRange)
                effectiveProperty = effectiveProperty.relatedShorthandProperty;

            let ownerRule = effectiveProperty ? effectiveProperty.ownerStyle.ownerRule : null;

            let arrowElement = this._contentElement.appendChild(WI.createGoToArrowButton());
            arrowElement.addEventListener("click", (event) => {
                if (!effectiveProperty || !ownerRule || !event.altKey) {
                    if (this._delegate.spreadsheetStylePropertyShowProperty)
                        this._delegate.spreadsheetStylePropertyShowProperty(this, this._property);
                    return;
                }

                let sourceCode = ownerRule.sourceCodeLocation.sourceCode;
                let {startLine, startColumn} = effectiveProperty.styleSheetTextRange;
                WI.showSourceCodeLocation(sourceCode.createSourceCodeLocation(startLine, startColumn), {
                    ignoreNetworkTab: true,
                    ignoreSearchTab: true,
                });
            });

            if (effectiveProperty && ownerRule)
                arrowElement.title = WI.UIString("Option-click to show source");
        }

        this.updateStatus();
    }

    updateStatus()
    {
        let duplicatePropertyExistsBelow = (cssProperty) => {
            let propertyFound = false;

            for (let property of this._property.ownerStyle.enabledProperties) {
                if (property === cssProperty)
                    propertyFound = true;
                else if (property.name === cssProperty.name && propertyFound)
                    return true;
            }

            return false;
        };

        let classNames = [WI.SpreadsheetStyleProperty.StyleClassName];
        let elementTitle = "";

        if (this._property.overridden) {
            if (!this._jumpToEffectivePropertyButton && this._delegate && this._delegate.spreadsheetStylePropertySelectByProperty && WI.settings.experimentalEnableStylesJumpToEffective.value) {
                console.assert(this._property.overridingProperty, `Overridden property is missing overridingProperty: ${this._property.formattedText}`);
                if (this._property.overridingProperty) {
                    this._jumpToEffectivePropertyButton = WI.createGoToArrowButton();
                    this._jumpToEffectivePropertyButton.classList.add("select-effective-property");
                    this._jumpToEffectivePropertyButton.dataset.value = this._property.overridingProperty.rawValue;
                    this._element.append(this._jumpToEffectivePropertyButton);

                    this._jumpToEffectivePropertyButton.addEventListener("click", (event) => {
                        console.assert(this._property.overridingProperty);
                        event.stop();
                        this._delegate.spreadsheetStylePropertySelectByProperty(this._property.overridingProperty);
                    });
                }
            }

            classNames.push("overridden");
            if (duplicatePropertyExistsBelow(this._property)) {
                classNames.push("has-warning");
                elementTitle = WI.UIString("Duplicate property");
            }
        }

        if (this._property.implicit)
            classNames.push("implicit");

        if (this._property.ownerStyle.inherited && !this._property.inherited)
            classNames.push("not-inherited");

        if (!this._property.valid && this._property.hasOtherVendorNameOrKeyword())
            classNames.push("other-vendor");
        else if (this._hasInvalidVariableValue || (!this._property.valid && this._property.value !== "")) {
            let propertyNameIsValid = false;
            if (WI.CSSCompletions.cssNameCompletions)
                propertyNameIsValid = WI.CSSCompletions.cssNameCompletions.isValidPropertyName(this._property.name);

            classNames.push("has-warning");

            if (!propertyNameIsValid) {
                classNames.push("invalid-name");
                elementTitle = WI.UIString("Unsupported property name");
            } else {
                classNames.push("invalid-value");
                elementTitle = WI.UIString("Unsupported property value");
            }
        }

        if (!this._property.enabled)
            classNames.push("disabled");

        if (this._property.modified && this._property.name && this._property.rawValue)
            classNames.push("modified");

        if (this._selected)
            classNames.push("selected");

        if (this._valueTextField && this._valueTextField.value.includes("\n"))
            classNames.push("has-newline");

        this._element.className = classNames.join(" ");
        this._element.title = elementTitle;
    }

    applyFilter(filterText)
    {
        let matchesName = this._nameElement.textContent.includes(filterText);
        this._nameElement.classList.toggle(WI.GeneralStyleDetailsSidebarPanel.FilterMatchSectionClassName, !!matchesName);

        let matchesValue = this._valueElement.textContent.includes(filterText);
        this._valueElement.classList.toggle(WI.GeneralStyleDetailsSidebarPanel.FilterMatchSectionClassName, !!matchesValue);

        let matches = matchesName || matchesValue;
        this._contentElement.classList.toggle(WI.GeneralStyleDetailsSidebarPanel.NoFilterMatchInPropertyClassName, !matches);
        return matches;
    }

    // SpreadsheetTextField delegate

    spreadsheetTextFieldWillStartEditing(textField)
    {
        let isEditingName = textField === this._nameTextField;
        textField.value = isEditingName ? this._property.name : this._property.rawValue;
    }

    spreadsheetTextFieldAllowsNewlines(textField)
    {
        return textField === this._valueTextField;
    }

    spreadsheetTextFieldDidChange(textField)
    {
        if (textField === this._valueTextField)
            this._handleValueChange();
        else if (textField === this._nameTextField)
            this._handleNameChange();
    }

    spreadsheetTextFieldDidCommit(textField, {direction})
    {
        let willRemoveProperty = false;
        let isEditingName = textField === this._nameTextField;

        if (!this._property.name || (!this._property.rawValue && !isEditingName && direction === "forward"))
            willRemoveProperty = true;

        if (!isEditingName && !willRemoveProperty)
            this._renderValue(this._property.rawValue);

        if (direction === "forward") {
            if (isEditingName && !willRemoveProperty) {
                // Move focus from the name to the value.
                this._valueTextField.startEditing();
                return;
            }
        } else {
            if (!isEditingName) {
                // Move focus from the value to the name.
                this._nameTextField.startEditing();
                return;
            }
        }

        if (typeof this._delegate.spreadsheetStylePropertyFocusMoved === "function") {
            // Move focus away from the current property, to the next or previous one, if exists, or to the next or previous rule, if exists.
            this._delegate.spreadsheetStylePropertyFocusMoved(this, {direction, willRemoveProperty});
        }

        if (willRemoveProperty)
            this.remove();
    }

    spreadsheetTextFieldDidBlur(textField, event, changed)
    {
        let focusedOutsideThisProperty = event.relatedTarget !== this._nameElement && event.relatedTarget !== this._valueElement;
        if (focusedOutsideThisProperty && (!this._nameTextField.value.trim() || !this._valueTextField.value.trim())) {
            this.remove();
            return;
        }

        if (textField === this._valueTextField)
            this._renderValue(this._property.rawValue);

        if (typeof this._delegate.spreadsheetStylePropertyFocusMoved === "function")
            this._delegate.spreadsheetStylePropertyFocusMoved(this, {direction: null});

        if (changed) {
            let target = WI.assumingMainTarget();
            if (target.hasDomain("DOM"))
                target.DOMAgent.markUndoableState();
        }
    }

    spreadsheetTextFieldDidBackspace(textField)
    {
        if (textField === this._nameTextField)
            this.spreadsheetTextFieldDidCommit(textField, {direction: "backward"});
        else if (textField === this._valueTextField)
            this._nameTextField.startEditing();
    }

    spreadsheetTextFieldDidPressEsc(textField, textBeforeEditing)
    {
        let isNewProperty = !textBeforeEditing;
        if (isNewProperty)
            this.remove();
        else if (this._delegate.spreadsheetStylePropertyDidPressEsc)
            this._delegate.spreadsheetStylePropertyDidPressEsc(this);
    }

    // Private

    _toggle()
    {
        this._property.commentOut(this.property.enabled);
        this.update();
    }

    _select()
    {
        if (this._delegate && this._delegate.spreadsheetStylePropertySelect) {
            let index = parseInt(this._element.dataset.propertyIndex);
            this._delegate.spreadsheetStylePropertySelect(index);
        }
    }

    _isEditable()
    {
        return !this._readOnly && this._property.editable;
    }

    _renderValue(value)
    {
        this._hasInvalidVariableValue = false;

        const maxValueLength = 150;
        let tokens = WI.tokenizeCSSValue(value);

        if (this._property.enabled)
            tokens = this._replaceSpecialTokens(tokens);

        tokens = tokens.map((token) => {
            if (token instanceof Element)
                return token;

            let className = "";

            if (token.type) {
                if (token.type.includes("string"))
                    className = "token-string";
                else if (token.type.includes("link"))
                    className = "token-link";
                else if (token.type.includes("comment"))
                    className = "token-comment";
            }

            if (className) {
                let span = document.createElement("span");
                span.classList.add(className);
                span.textContent = token.value.truncateMiddle(maxValueLength);

                if (token.type && token.type.includes("link"))
                    span.addEventListener("contextmenu", this._handleLinkContextMenu.bind(this, token));

                return span;
            }

            return token.value;
        });

        this._valueElement.removeChildren();
        this._valueElement.append(...tokens);
    }

    _createInlineSwatch(type, contents, valueObject)
    {
        let tokenElement = document.createElement("span");
        let innerElement = document.createElement("span");
        for (let item of contents) {
            if (item instanceof Node)
                innerElement.appendChild(item);
            else if (typeof item === "object")
                innerElement.append(item.value);
            else
                innerElement.append(item);
        }

        let readOnly = !this._isEditable();
        let swatch = new WI.InlineSwatch(type, valueObject, readOnly);

        swatch.addEventListener(WI.InlineSwatch.Event.ValueChanged, (event) => {
            let value = event.data.value && event.data.value.toString();
            if (!value)
                return;

            innerElement.textContent = value;
            this._handleValueChange();

            if (type === WI.InlineSwatch.Type.Variable)
                this._renderValue(this._property.rawValue);
        }, this);

        if (type === WI.InlineSwatch.Type.Variable) {
            swatch.value = () => {
                return this._property.ownerStyle.nodeStyles.computedStyle.resolveVariableValue(innerElement.textContent);
            };
        }

        if (this._delegate && typeof this._delegate.stylePropertyInlineSwatchActivated === "function") {
            swatch.addEventListener(WI.InlineSwatch.Event.Activated, () => {
                this._delegate.stylePropertyInlineSwatchActivated();
            });
        }

        if (this._delegate && typeof this._delegate.stylePropertyInlineSwatchDeactivated === "function") {
            swatch.addEventListener(WI.InlineSwatch.Event.Deactivated, () => {
                this._delegate.stylePropertyInlineSwatchDeactivated();
            });
        }

        tokenElement.append(swatch.element, innerElement);

        return tokenElement;
    }

    _replaceSpecialTokens(tokens)
    {
        // FIXME: <https://webkit.org/b/178636> Web Inspector: Styles: Make inline widgets work with CSS functions (var(), calc(), etc.)

        if (this._property.name === "box-shadow")
            return this._addBoxShadowTokens(tokens);

        tokens = this._addVariableTokens(tokens);

        if (this._property.isVariable || WI.CSSKeywordCompletions.isColorAwareProperty(this._property.name)) {
            tokens = this._addGradientTokens(tokens);
            tokens = this._addColorTokens(tokens);
        }

        if (this._property.isVariable || WI.CSSKeywordCompletions.isTimingFunctionAwareProperty(this._property.name)) {
            tokens = this._addTimingFunctionTokens(tokens, "cubic-bezier");
            tokens = this._addTimingFunctionTokens(tokens, "spring");
        }

        return tokens;
    }

    _addGradientTokens(tokens)
    {
        let gradientRegex = /^(repeating-)?(linear|radial)-gradient$/i;
        let newTokens = [];
        let gradientStartIndex = NaN;
        let openParenthesis = 0;

        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (token.type && token.type.includes("atom") && gradientRegex.test(token.value)) {
                gradientStartIndex = i;
                openParenthesis = 0;
            } else if (token.value === "(" && !isNaN(gradientStartIndex))
                openParenthesis++;
            else if (token.value === ")" && !isNaN(gradientStartIndex)) {
                openParenthesis--;
                if (openParenthesis > 0) {
                    // Matched a CSS function inside of the gradient.
                    continue;
                }

                let rawTokens = tokens.slice(gradientStartIndex, i + 1);
                let text = this._resolveVariables(rawTokens.map((token) => token.value).join(""));
                let gradient = WI.Gradient.fromString(text);
                if (gradient)
                    newTokens.push(this._createInlineSwatch(WI.InlineSwatch.Type.Gradient, rawTokens, gradient));
                else
                    newTokens.pushAll(rawTokens);

                gradientStartIndex = NaN;
            } else if (isNaN(gradientStartIndex))
                newTokens.push(token);
        }

        return newTokens;
    }

    _addColorTokens(tokens)
    {
        let newTokens = [];
        let openParentheses = 0;

        let pushPossibleColorToken = (text, ...rawTokens) => {
            let color = WI.Color.fromString(text);
            if (color)
                newTokens.push(this._createInlineSwatch(WI.InlineSwatch.Type.Color, rawTokens, color));
            else
                newTokens.pushAll(rawTokens);
        };

        let colorFunctionStartIndex = NaN;

        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (token.type && token.type.includes("hex-color")) {
                // Hex
                pushPossibleColorToken(token.value, token);
            } else if (WI.Color.FunctionNames.has(token.value) && token.type && (token.type.includes("atom") || token.type.includes("keyword"))) {
                // Color Function start
                colorFunctionStartIndex = i;
            } else if (isNaN(colorFunctionStartIndex) && token.type && (token.type.includes("atom") || token.type.includes("keyword"))) {
                // Color keyword
                pushPossibleColorToken(token.value, token);
            } else if (!isNaN(colorFunctionStartIndex)) {
                if (token.value === "(") {
                    ++openParentheses;
                    continue;
                }

                if (token.value === ")") {
                    --openParentheses;
                    if (openParentheses)
                        continue;
                }

                // Color Function end

                let rawTokens = tokens.slice(colorFunctionStartIndex, i + 1);
                let text = this._resolveVariables(rawTokens.map((token) => token.value).join(""));
                pushPossibleColorToken(text, ...rawTokens);
                colorFunctionStartIndex = NaN;
            } else
                newTokens.push(token);
        }

        return newTokens;
    }

    _addTimingFunctionTokens(tokens, tokenType)
    {
        let newTokens = [];
        let startIndex = NaN;
        let openParenthesis = 0;

        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (token.value === tokenType && token.type && token.type.includes("atom")) {
                startIndex = i;
                openParenthesis = 0;
            } else if (token.value === "(" && !isNaN(startIndex))
                openParenthesis++;
            else if (token.value === ")" && !isNaN(startIndex)) {

                openParenthesis--;
                if (openParenthesis > 0)
                    continue;

                let rawTokens = tokens.slice(startIndex, i + 1);
                let text = this._resolveVariables(rawTokens.map((token) => token.value).join(""));

                let valueObject;
                let inlineSwatchType;
                if (tokenType === "cubic-bezier") {
                    valueObject = WI.CubicBezier.fromString(text);
                    inlineSwatchType = WI.InlineSwatch.Type.Bezier;
                } else if (tokenType === "spring") {
                    valueObject = WI.Spring.fromString(text);
                    inlineSwatchType = WI.InlineSwatch.Type.Spring;
                }

                if (valueObject)
                    newTokens.push(this._createInlineSwatch(inlineSwatchType, rawTokens, valueObject));
                else
                    newTokens.pushAll(rawTokens);

                startIndex = NaN;
            } else if (token.value in WI.CubicBezier.keywordValues)
                newTokens.push(this._createInlineSwatch(WI.InlineSwatch.Type.Bezier, [token], WI.CubicBezier.fromString(token.value)));
            else if (isNaN(startIndex))
                newTokens.push(token);
        }

        return newTokens;
    }

    _addBoxShadowTokens(tokens)
    {
        let newTokens = [];
        let startIndex = 0;
        let openParentheses = 0;

        for (let i = 0; i <= tokens.length; i++) {
            let token = tokens[i];
            if (i === tokens.length || (token.value === "," && !openParentheses)) {
                let rawTokens = tokens.slice(startIndex, i);

                let firstNonWhitespaceIndex = Infinity;
                let lastNonWhitespaceIndex = 0;
                for (let j = 0; j < rawTokens.length; ++j) {
                    if (/\s/.test(rawTokens[j].value))
                        continue;

                    firstNonWhitespaceIndex = Math.min(firstNonWhitespaceIndex, j);
                    lastNonWhitespaceIndex = Math.max(lastNonWhitespaceIndex, j);
                }

                let nonWhitespaceTokens = rawTokens.slice(firstNonWhitespaceIndex, lastNonWhitespaceIndex + 1);

                newTokens.pushAll(rawTokens.slice(0, firstNonWhitespaceIndex));

                let text = this._resolveVariables(nonWhitespaceTokens.map((rawToken) => rawToken.value).join(""));
                let boxShadow = WI.BoxShadow.fromString(text);
                if (boxShadow)
                    newTokens.push(this._createInlineSwatch(WI.InlineSwatch.Type.BoxShadow, nonWhitespaceTokens, boxShadow));
                else
                    newTokens.pushAll(nonWhitespaceTokens);

                newTokens.pushAll(rawTokens.slice(lastNonWhitespaceIndex + 1));

                if (token)
                    newTokens.push(token);

                startIndex = i + 1;
                continue;
            }

            if (token.value === "(") {
                ++openParentheses;
                continue;
            }

            if (token.value === ")") {
                --openParentheses;
                continue;
            }
        }

        return newTokens;
    }

    _addVariableTokens(tokens)
    {
        let newTokens = [];
        let startIndex = NaN;
        let openParenthesis = 0;

        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (token.value === "var" && token.type && token.type.includes("atom")) {
                if (isNaN(startIndex)) {
                    startIndex = i;
                    openParenthesis = 0;
                }
            } else if (token.value === "(" && !isNaN(startIndex))
                ++openParenthesis;
            else if (token.value === ")" && !isNaN(startIndex)) {
                --openParenthesis;
                if (openParenthesis > 0)
                    continue;

                let rawTokens = tokens.slice(startIndex, i + 1);
                let variableNameIndex = rawTokens.findIndex((token) => token.value.startsWith("--") && /\bvariable-2\b/.test(token.type));
                if (variableNameIndex !== -1) {
                    let contents = [];
                    let fallbackStartIndex = rawTokens.findIndex((value, i) => i > variableNameIndex + 1 && /\bm-css\b/.test(value.type));
                    if (fallbackStartIndex !== -1) {
                        contents.pushAll(rawTokens.slice(0, fallbackStartIndex));
                        contents.pushAll(this._replaceSpecialTokens(rawTokens.slice(fallbackStartIndex, i)));
                    } else
                        contents.pushAll(rawTokens.slice(0, i));
                    contents.push(token);

                    let text = rawTokens.reduce((accumulator, token) => accumulator + token.value, "");
                    if (this._property.ownerStyle.nodeStyles.computedStyle.resolveVariableValue(text))
                        newTokens.push(this._createInlineSwatch(WI.InlineSwatch.Type.Variable, contents));
                    else
                        newTokens.pushAll(contents);
                } else {
                    this._hasInvalidVariableValue = true;
                    newTokens.pushAll(rawTokens);
                }

                startIndex = NaN;
            } else if (isNaN(startIndex))
                newTokens.push(token);
        }

        return newTokens;
    }

    _resolveVariables(cssText)
    {
        return cssText.replace(/var\(--[^\)]+\)/g, (match) => this._property.ownerStyle.nodeStyles.computedStyle.resolveVariableValue(match) || match);
    }

    _handleNameChange()
    {
        this._property.name = this._nameElement.textContent.trim();
    }

    _handleValueChange()
    {
        let value = this._valueElement.textContent;

        this._property.rawValue = value.trim();

        this._element.classList.toggle("has-newline", value.includes("\n"));
    }

    _handleNameBeforeInput(event)
    {
        if (event.data !== ":" || event.inputType !== "insertText")
            return;

        event.preventDefault();
        this._nameTextField.discardCompletion();
        this._valueTextField.startEditing();
    }

    _handleNamePaste(event)
    {
        let text = event.clipboardData.getData("text/plain");
        if (!text || !text.includes(":"))
            return;

        event.preventDefault();

        this.remove(text);

        if (this._delegate.spreadsheetStylePropertyAddBlankPropertySoon) {
            this._delegate.spreadsheetStylePropertyAddBlankPropertySoon(this, {
                index: parseInt(this._element.dataset.propertyIndex) + 1,
            });
        }
    }

    _nameCompletionDataProvider(prefix, options = {})
    {
        let completions;
        if (!prefix && options.allowEmptyPrefix)
            completions = WI.CSSCompletions.cssNameCompletions.values;
        else
            completions = WI.CSSCompletions.cssNameCompletions.startsWith(prefix);
        return {prefix, completions};
    }

    _handleValueBeforeInput(event)
    {
        if (event.data !== ";" || event.inputType !== "insertText")
            return;

        let text = this._valueTextField.valueWithoutSuggestion();
        let selection = window.getSelection();
        if (!selection.rangeCount || selection.getRangeAt(0).endOffset !== text.length)
            return;

        let unbalancedCharacters = WI.CSSCompletions.completeUnbalancedValue(text);
        if (unbalancedCharacters)
            return;

        event.preventDefault();
        this._valueTextField.stopEditing();
        this.spreadsheetTextFieldDidCommit(this._valueTextField, {direction: "forward"});
    }

    _valueCompletionDataProvider(prefix)
    {
        // For "border: 1px so|", we want to suggest "solid" based on "so" prefix.
        let match = prefix.match(/[a-z0-9()-]+$/i);

        // Clicking on the value of `height: 100%` shouldn't show any completions.
        if (!match && prefix)
            return {completions: [], prefix: ""};

        prefix = match ? match[0] : "";
        let propertyName = this._nameElement.textContent.trim();
        return {
            prefix,
            completions: WI.CSSKeywordCompletions.forProperty(propertyName).startsWith(prefix)
        };
    }

    _setupJumpToSymbol(element)
    {
        element.addEventListener("mousedown", (event) => {
            if (event.button !== 0)
                return;

            if (!WI.modifierKeys.metaKey)
                return;

            if (element.isContentEditable)
                return;

            let sourceCodeLocation = null;
            if (this._property.ownerStyle.ownerRule)
                sourceCodeLocation = this._property.ownerStyle.ownerRule.sourceCodeLocation;

            if (!sourceCodeLocation)
                return;

            let range = this._property.styleSheetTextRange;
            const options = {
                ignoreNetworkTab: true,
                ignoreSearchTab: true,
                initiatorHint: WI.TabBrowser.TabNavigationInitiator.LinkClick,
            };
            let sourceCode = sourceCodeLocation.sourceCode;
            WI.showSourceCodeLocation(sourceCode.createSourceCodeLocation(range.startLine, range.startColumn), options);
        });
    }

    _handleLinkContextMenu(token, event)
    {
        let contextMenu = WI.ContextMenu.createFromEvent(event);

        let resolveURL = (url) => {
            let ownerStyle = this._property.ownerStyle;
            if (!ownerStyle)
                return url;

            let ownerStyleSheet = ownerStyle.ownerStyleSheet;
            if (!ownerStyleSheet) {
                let ownerRule = ownerStyle.ownerRule;
                if (ownerRule)
                    ownerStyleSheet = ownerRule.ownerStyleSheet;
            }
            if (ownerStyleSheet) {
                if (ownerStyleSheet.url)
                    return absoluteURL(url, ownerStyleSheet.url);

                let parentFrame = ownerStyleSheet.parentFrame;
                if (parentFrame)
                    return absoluteURL(url, parentFrame.url);
            }

            let node = ownerStyle.node;
            if (!node) {
                let nodeStyles = ownerStyle.nodeStyles;
                if (!nodeStyles) {
                    let ownerRule = ownerStyle.ownerRule;
                    if (ownerRule)
                        nodeStyles = ownerRule.nodeStyles;
                }
                if (nodeStyles)
                    node = nodeStyles.node;
            }
            if (node) {
                let ownerDocument = node.ownerDocument;
                if (ownerDocument)
                    return absoluteURL(url, node.ownerDocument.documentURL);
            }

            return url;
        };

        WI.appendContextMenuItemsForURL(contextMenu, resolveURL(token.value));
    }
};

WI.SpreadsheetStyleProperty.StyleClassName = "property";
