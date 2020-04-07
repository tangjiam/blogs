/**
 * @author Kuitos
 * @since 2019-10-21
 */
import { execScripts } from 'import-html-entry';
import { isFunction } from 'lodash';
import { checkActivityFunctions } from 'single-spa';
import { Freer } from '../../interfaces';
import { getImportLoaderConfiguration } from '../../register';
import { getWrapperId } from '../../utils';

const styledComponentSymbol = Symbol('styled-component');

declare global {
  interface HTMLStyleElement {
    // eslint-disable-next-line no-undef
    [styledComponentSymbol]?: CSSRuleList;
  }
}

const rawHeadAppendChild = HTMLHeadElement.prototype.appendChild;
const rawHeadRemoveChild = HTMLHeadElement.prototype.removeChild;
const rawAppendChild = HTMLElement.prototype.appendChild;
const rawRemoveChild = HTMLElement.prototype.removeChild;

const SCRIPT_TAG_NAME = 'SCRIPT';
const LINK_TAG_NAME = 'LINK';
const STYLE_TAG_NAME = 'STYLE';

/**
 * Check if a style element is a styled-component liked.
 * A styled-components liked element is which not have textContext but keep the rules in its styleSheet.cssRules.
 * Such as the style element generated by styled-components and emotion.
 * @param element
 */
function isStyledComponentsLike(element: HTMLStyleElement) {
  return !element.textContent && ((element.sheet as CSSStyleSheet)?.cssRules.length || getCachedRules(element)?.length);
}

function getCachedRules(element: HTMLStyleElement) {
  return element[styledComponentSymbol];
}

function setCachedRules(element: HTMLStyleElement, cssRules: CSSRuleList) {
  Object.defineProperty(element, styledComponentSymbol, { value: cssRules, configurable: true, enumerable: false });
}

function assertElementExist(appName: string, element: Element | null) {
  if (!element) throw new Error(`[qiankun] ${appName} wrapper with id ${getWrapperId(appName)} not ready!`);
}

function getWrapperElement(appName: string) {
  return document.getElementById(getWrapperId(appName));
}

export default function patch(appName: string, proxy: Window, mounting = true): Freer {
  let dynamicStyleSheetElements: Array<HTMLLinkElement | HTMLStyleElement> = [];

  HTMLHeadElement.prototype.appendChild = function appendChild<T extends Node>(this: HTMLHeadElement, newChild: T) {
    const element = newChild as any;
    if (element.tagName) {
      switch (element.tagName) {
        case LINK_TAG_NAME:
        case STYLE_TAG_NAME: {
          const stylesheetElement: HTMLLinkElement | HTMLStyleElement = newChild as any;

          const activated = checkActivityFunctions(window.location).some(name => name === appName);
          if (activated) {
            dynamicStyleSheetElements.push(stylesheetElement);

            const appWrapper = getWrapperElement(appName);
            assertElementExist(appName, appWrapper);
            return rawAppendChild.call(appWrapper, stylesheetElement) as T;
          }

          return rawHeadAppendChild.call(this, element) as T;
        }

        case SCRIPT_TAG_NAME: {
          const { src, text } = element as HTMLScriptElement;

          const { fetch } = getImportLoaderConfiguration();
          if (src) {
            execScripts(null, [src], proxy, { fetch }).then(
              () => {
                const loadEvent = new CustomEvent('load');
                if (isFunction(element.onload)) {
                  element.onload(loadEvent);
                } else {
                  element.dispatchEvent(loadEvent);
                }
              },
              () => {
                const errorEvent = new CustomEvent('error');
                if (isFunction(element.onerror)) {
                  element.onerror(errorEvent);
                } else {
                  element.dispatchEvent(errorEvent);
                }
              },
            );

            const dynamicScriptCommentElement = document.createComment(`dynamic script ${src} replaced by qiankun`);
            const appWrapper = getWrapperElement(appName);
            assertElementExist(appName, appWrapper);
            return rawAppendChild.call(appWrapper, dynamicScriptCommentElement) as T;
          }

          execScripts(null, [`<script>${text}</script>`], proxy).then(element.onload, element.onerror);
          const dynamicInlineScriptCommentElement = document.createComment('dynamic inline script replaced by qiankun');
          const appWrapper = getWrapperElement(appName);
          assertElementExist(appName, appWrapper);
          return rawAppendChild.call(appWrapper, dynamicInlineScriptCommentElement) as T;
        }

        default:
          break;
      }
    }

    return rawHeadAppendChild.call(this, element) as T;
  };

  HTMLHeadElement.prototype.removeChild = function removeChild<T extends Node>(this: HTMLHeadElement, child: T) {
    const appWrapper = getWrapperElement(appName);
    if (appWrapper?.contains(child)) {
      return rawRemoveChild.call(appWrapper, child) as T;
    }

    return rawHeadRemoveChild.call(this, child) as T;
  };

  return function free() {
    HTMLHeadElement.prototype.appendChild = rawHeadAppendChild;
    HTMLHeadElement.prototype.removeChild = rawHeadRemoveChild;

    dynamicStyleSheetElements.forEach(stylesheetElement => {
      if (stylesheetElement instanceof HTMLStyleElement && isStyledComponentsLike(stylesheetElement)) {
        if (stylesheetElement.sheet) {
          setCachedRules(stylesheetElement, (stylesheetElement.sheet as CSSStyleSheet).cssRules);
        }
      }
    });

    return function rebuild() {
      dynamicStyleSheetElements.forEach(stylesheetElement => {
        const appWrapper = getWrapperElement(appName);
        assertElementExist(appName, appWrapper);
        document.head.appendChild.call(appWrapper!, stylesheetElement);

        if (stylesheetElement instanceof HTMLStyleElement && isStyledComponentsLike(stylesheetElement)) {
          const cssRules = getCachedRules(stylesheetElement);
          if (cssRules) {
            // eslint-disable-next-line no-plusplus
            for (let i = 0; i < cssRules.length; i++) {
              const cssRule = cssRules[i];
              (stylesheetElement.sheet as CSSStyleSheet).insertRule(cssRule.cssText);
            }
          }
        }
      });

      if (mounting) {
        dynamicStyleSheetElements = [];
      }
    };
  };
}