import { JSDOM } from "jsdom";
import { ObjectAny } from "../../interfaces/general.i.js";
import { HtmlExtractionsResult } from "../../interfaces/etl.i.js";
import turndownService from "../turndown.utils.js";
import DOMPurify from "isomorphic-dompurify";
import {
  configurePage,
  getBrowserInstance,
  setupPageListeners,
  uploadFile,
} from "../helper.util.js";
import { tidyMarkdown } from "./markdown.js";
/*
    NOTE: The core concept of this module is to extract the body of the HTML for turndown it into markdown
    and clean it up to be used in the LLM.

    TODO:
    1. Extract the body of the HTML
    2. Transform the body of the HTML to be cleaned up as rules below:
    -- CLEANUP RULES:
    -- 1. Remove header, footer, sidebar and any other element that used for navigation
    -- 1.1 For all block item inside header element, just keep it
    -- 2. Remove all script tag
    -- 3. Remove all style tag
    -- 4. Remove all comment
    -- 5. Remove all hidden element
    -- 6. Remove all element that  need an interaction to show it eg. modal, dropdown, button, etc
    -- 6.1 Remove all element form related eg. input, button, select
    -- 7. Remove all element that likely to be an boilerplate eg. copyright, detail, summary, template, dl, dd, dt, etc
    3. Tranform the HTML to markdown converter and load as temporary markdown file
* */

const BLACKLIST_TAGS: string[] = [
  "SCRIPT",
  "STYLE",
  "COMMENT",
  "DETAIL",
  "SUMMARY",
  "TEMPLATE",
  "DL",
  "DD",
  "DT",
  "NAV",
  "BUTTON",
  "HR",
];

const REMOVED_ATTRS: string[] = [
  "class",
  "id",
  "style",
  "role",
  "aria",
  "data",
  "tabindex",
  "onclick",
  "onchange",
];

const headerChecker = (element: Element) => {
  if (BLACKLIST_TAGS.includes(element.tagName)) {
    element.remove();
  }
};

const bodyChecker = (element: Element) => {
  if (BLACKLIST_TAGS.includes(element.tagName)) {
    element.remove();
  }
  if (element.tagName === "HEADER") {
    element.querySelectorAll("*").forEach(headerChecker);
  }
  // remove any attribute except url related
  REMOVED_ATTRS.forEach((attr) => {
    element.removeAttribute(attr);
  });
  if (element.tagName == "TABLE") {
    console.log("Table element:", element.innerHTML);
  }
  console.log("\n\nEach element:", element.tagName);
};

export function getPageMeta(document: Document): ObjectAny {
  const meta: ObjectAny = {};
  let cnt = 0;

  function processMetaElement(element: Element) {
    const name = element.getAttribute("name");
    const property = element.getAttribute("property");
    const content = element.getAttribute("content");

    if (content) {
      if (property) {
        if (property.startsWith("og:image")) {
          return true;
        }
        if (property.startsWith("og:")) {
          meta[property] = content;
          cnt += 1;
          return true;
        }
      }
      if (name) {
        if (name.startsWith("article:")) {
          meta[name] = content;
          cnt += 1;
          return true;
        }
        if (name.startsWith("description")) {
          meta[name] = content;
          cnt += 1;
          return true;
        }
      }
    }

    return false;
  }
  const metaElements = document.querySelectorAll("meta");
  for (let i = 0; i < metaElements.length; i++) {
    processMetaElement(metaElements[i]);
    if (cnt > 10) {
      break;
    }
  }

  return meta;
}

export function extract(html: string) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const data: HtmlExtractionsResult = {
    title: "",
    meta: {},
    content: "",
  };

  const title = document.title;
  data["title"] = title;
  const meta = getPageMeta(document);
  data["meta"] = meta;
  let body = document.querySelector("body");
  if (body) {
    body.querySelectorAll("*").forEach(bodyChecker);
    data["content"] = DOMPurify.sanitize(body.innerHTML);
    return data;
  }
  return data;
}

export function transform(data: HtmlExtractionsResult) {
  const contentMarkdown = turndownService.turndown(data.content);
  const cleanMarkdown = tidyMarkdown(contentMarkdown);
  const markdownPath = "assets/tmp/markdown.md";
  uploadFile(cleanMarkdown, markdownPath);
  return { markdownPath, cleanMarkdown };
}

export function process(html: string) {
  const data = extract(html);
  const { markdownPath, cleanMarkdown: markdown } = transform(data);
  return { markdownPath, markdown, data };
}

const getHtml = async (baseUrl: string) => {
  const config = {
    url: baseUrl,
    ping: "https://dev.mrscraper.com/results/1464/lambda/extractions",
    code: "-KUwRhCvpSKOTvemrR=3l-wOWjboHH4tdCl?gZvaW!cX5YqQSYvAO5=kYhNjyJE7bTzmc!89Re0rdjnSFohFKAT=xkbh?0f-CyrBSM8AxqMbIupcIe6VEuvjqQt/iuKWAgwKh5QbX69o8OC3iCCIqLaL0d/znekc4cN7F=30VxsV?yvKN9/TBXmPZPje7HCmAbKL2uzk9z5qN8sGvWBKijNaT2a9Iw/5!3oK/sagsrhoQpxaw?fJl!nZ1Xc69g4G",
    timeout: 900000,
    result_id: 1464,
    bucket: "mrscraper-data-dev-new",
    auth: {
      host: "p.webshare.io",
      port: "80",
      username: "xjrxxdsh-rotate",
      password: "bs1a64qlhfnk",
    },
    proxy_server: "p.webshare.io:80",
    user_agent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    http_headers: [],
    cookies: [],
  };

  // open a browser
  const browser = await getBrowserInstance(config);

  // open a page
  const page = await browser.newPage();

  await configurePage(page, config);
  await setupPageListeners(page);

  await page.goto(config.url, {
    waitUntil: ["load", "domcontentloaded", "networkidle0"],
  });

  const html = await page.content();

  await browser.close();

  return html;
};

export default class ETLHtml {
  constructor() {}
  public process(html: string) {
    return process(html);
  }
  public getHtml(url: string) {
    return getHtml(url);
  }
}
