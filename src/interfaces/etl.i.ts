import { CookieParam } from "puppeteer";
import { ObjectAny } from "./general.i.js";

export interface HtmlExtractionsResult {
  title: string;
  meta: ObjectAny;
  content: string;
}

export interface ImgBrief {
  src: string;
  loaded?: boolean;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  alt?: string;
}

export interface ReadabilityParsed {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string;
  dir: string;
  siteName: string;
  lang: string;
  publishedTime: string;
}

export interface PageSnapshot {
  title: string;
  href: string;
  rebase?: string;
  html: string;
  text: string;
  parsed?: Partial<ReadabilityParsed> | null;
  screenshot?: Buffer;
  pageshot?: Buffer;
  imgs?: ImgBrief[];
  pdfs?: string[];
  maxElemDepth?: number;
  elemCount?: number;
  childFrames?: PageSnapshot[];
}

export interface ExtendedSnapshot extends PageSnapshot {
  links: { [url: string]: string };
  imgs: ImgBrief[];
}

export interface ScrappingOptions {
  proxyUrl?: string;
  cookies?: CookieParam[];
  favorScreenshot?: boolean;
  waitForSelector?: string | string[];
  minIntervalMs?: number;
  overrideUserAgent?: string;
  timeoutMs?: number;
  locale?: string;
}
