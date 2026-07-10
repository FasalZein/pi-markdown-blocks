import {
	VERSION,
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	Markdown,
	truncateToWidth,
	type MarkdownTheme,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { marked } from "marked";

const PATCH_STATE = Symbol.for("pi-markdown-blocks.markdown-renderer");
const RESET = "\x1b[0m";
const RESET_BACKGROUND = "\x1b[49m";
const RESET_FOREGROUND = "\x1b[39m";

type Rgb = readonly [number, number, number];
type Config = {
	margin: number;
	background: boolean;
	backgroundColor?: Rgb;
	borderColor?: Rgb;
};
type CopyBlock = { language: string; content: string };
type CodeToken = { type: "code"; text: string; lang?: string };
type RuntimeTheme = Pick<Theme, "fg" | "getBgAnsi">;
type RenderToken = (
	this: Markdown,
	token: unknown,
	width: number,
	nextTokenType?: string,
	styleContext?: unknown,
) => string[];
type PatchState = { original: RenderToken; patched: RenderToken; enabled: boolean };
type MarkdownRuntime = { renderToken?: RenderToken; [key: symbol]: unknown };

function parseRgb(value: string | undefined): Rgb | undefined {
	if (!value || !/^\d{1,3};\d{1,3};\d{1,3}$/.test(value)) return undefined;
	const channels = value.split(";").map(Number);
	if (channels.some((channel) => channel < 0 || channel > 255)) return undefined;
	return channels as unknown as Rgb;
}

function config(): Config {
	const value = process.env.PI_CODEBLOCKS_MARGIN;
	const margin = value && /^\d+$/.test(value) ? Number(value) : 0;
	return {
		margin,
		background: process.env.PI_CODEBLOCKS_BG === "1",
		backgroundColor: parseRgb(process.env.PI_CODEBLOCKS_BG_COLOR),
		borderColor: parseRgb(process.env.PI_CODEBLOCKS_BORDER_COLOR),
	};
}

function assistantText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n\n");
}

function extractBlocks(content: unknown): CopyBlock[] {
	const blocks: CopyBlock[] = [];
	try {
		marked.walkTokens(marked.lexer(assistantText(content)), (token) => {
			if (token.type !== "code" || token.codeBlockStyle === "indented") return;
			blocks.push({
				language: token.lang?.trim().split(/\s+/, 1)[0] || "text",
				content: token.text,
			});
		});
	} catch {
		return [];
	}
	return blocks;
}

function restoreBlocks(context: ExtensionContext): CopyBlock[] {
	const branch = context.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry.type === "message" && entry.message.role === "assistant") {
			return extractBlocks(entry.message.content);
		}
	}
	return [];
}

function pickerLabel(block: CopyBlock, index: number): string {
	const lines = block.content.split("\n");
	const firstLine = lines.find((line) => line.trim())?.trim() ?? "";
	const preview = firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine;
	return `${index + 1} · ${block.language} · ${lines.length}L · ${preview}`;
}

function borderStyle(theme: MarkdownTheme, settings: Config, text: string): string {
	if (settings.borderColor) {
		return `\x1b[38;2;${settings.borderColor.join(";")}m${text}${RESET_FOREGROUND}`;
	}
	return theme.codeBlockBorder(text);
}

function topBorder(theme: MarkdownTheme, settings: Config, label: string, width: number): string {
	const styledLabel = (text: string) => theme.link(theme.bold(text));
	if (width < 7) {
		const visibleLabel = truncateToWidth(label, Math.max(1, width - 2), "…");
		const fill = "─".repeat(Math.max(0, width - 2 - visibleWidth(visibleLabel)));
		return (
			borderStyle(theme, settings, "╭") +
			styledLabel(visibleLabel) +
			borderStyle(theme, settings, `${fill}╮`)
		);
	}

	const visibleLabel = truncateToWidth(label, width - 5, "…");
	const fill = "─".repeat(Math.max(0, width - 5 - visibleWidth(visibleLabel)));
	return (
		borderStyle(theme, settings, "╭─ ") +
		styledLabel(visibleLabel) +
		borderStyle(theme, settings, ` ${fill}╮`)
	);
}

function shellStyle(
	runtimeTheme: RuntimeTheme | undefined,
	theme: MarkdownTheme,
	color: "syntaxFunction" | "syntaxVariable" | "syntaxComment",
	text: string,
): string {
	if (runtimeTheme) return runtimeTheme.fg(color, text);
	if (color === "syntaxFunction") return theme.link(text);
	if (color === "syntaxVariable") return theme.code(text);
	return theme.quote(text);
}

function highlightShell(line: string, theme: MarkdownTheme, runtimeTheme?: RuntimeTheme): string {
	if (/^\s*#/.test(line)) return shellStyle(runtimeTheme, theme, "syntaxComment", line);
	return line.replace(
		/(^|[|&;]\s*)([A-Za-z0-9_./-]+)|(\s)(--?[A-Za-z0-9][A-Za-z0-9_-]*)/g,
		(match, commandPrefix: string, command: string, flagPrefix: string, flag: string) => {
			if (command) {
				return `${commandPrefix}${shellStyle(runtimeTheme, theme, "syntaxFunction", command)}`;
			}
			if (flag) return `${flagPrefix}${shellStyle(runtimeTheme, theme, "syntaxVariable", flag)}`;
			return match;
		},
	);
}

function highlightedLines(
	theme: MarkdownTheme,
	runtimeTheme: RuntimeTheme | undefined,
	code: string,
	language: string,
): string[] {
	if (/^(?:(?:ba|z|fi)?sh|shell|fish|powershell|ps1|console)$/i.test(language)) {
		return code.split("\n").map((line) => highlightShell(line, theme, runtimeTheme));
	}
	return theme.highlightCode
		? theme.highlightCode(code, language)
		: code.split("\n").map((line) => theme.codeBlock(line));
}

function renderCodeBlock(
	markdown: { theme: MarkdownTheme },
	token: CodeToken,
	width: number,
	nextTokenType: string | undefined,
	runtimeTheme: RuntimeTheme | undefined,
): string[] {
	if (width < 4) throw new Error("Markdown width is too narrow for a framed block");
	const theme = markdown.theme;
	const settings = config();
	const margin = width - settings.margin * 2 >= 8 ? settings.margin : 0;
	const blockWidth = width - margin * 2;
	const padding = blockWidth >= 5 ? 1 : 0;
	const innerWidth = Math.max(1, blockWidth - 2 - padding * 2);
	const prefix = " ".repeat(margin);
	const label = token.lang?.trim().split(/\s+/, 1)[0] || "text";
	let background: string | undefined;
	if (settings.background) {
		background = settings.backgroundColor
			? `\x1b[48;2;${settings.backgroundColor.join(";")}m`
			: runtimeTheme?.getBgAnsi("customMessageBg");
	}

	const output = [prefix + topBorder(theme, settings, label, blockWidth)];
	for (const line of highlightedLines(theme, runtimeTheme, token.text, label)) {
		for (const part of wrapTextWithAnsi(line, innerWidth)) {
			const left = borderStyle(theme, settings, "│");
			const right = borderStyle(theme, settings, "│");
			const pad = " ".repeat(padding);
			const fill = " ".repeat(Math.max(0, innerWidth - visibleWidth(part)));
			if (!background) {
				output.push(`${prefix}${left}${pad}${part}${fill}${pad}${right}`);
				continue;
			}
			// Syntax highlighters may reset all styles; re-apply the configured background.
			const safePart = part
				.replaceAll(RESET, `${RESET}${background}`)
				.replaceAll(RESET_BACKGROUND, `${RESET_BACKGROUND}${background}`);
			output.push(
				`${prefix}${left}${background}${pad}${safePart}${fill}${pad}${RESET_BACKGROUND}${right}`,
			);
		}
	}
	output.push(prefix + borderStyle(theme, settings, `╰${"─".repeat(blockWidth - 2)}╯`));
	if (nextTokenType && nextTokenType !== "space") output.push("");
	return output;
}

function isPatchState(value: unknown): value is PatchState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<PatchState>;
	return (
		typeof state.original === "function" &&
		typeof state.patched === "function" &&
		typeof state.enabled === "boolean"
	);
}

// Pi 0.80 has no public fenced-token hook, so keep the private boundary isolated here.
function installRenderer(getRuntimeTheme: () => RuntimeTheme | undefined) {
	const match = /^0\.80\.(\d+)(?:-|$)/.exec(VERSION);
	if (!match || Number(match[1]) < 6) {
		return { installed: false as const, reason: `unsupported Pi version ${VERSION}` };
	}

	const prototype = Markdown.prototype as unknown as MarkdownRuntime;
	const existing = prototype[PATCH_STATE];
	if (isPatchState(existing)) {
		if (prototype.renderToken !== existing.patched) {
			return { installed: false as const, reason: "another extension replaced the Markdown renderer" };
		}
		prototype.renderToken = existing.original;
		delete prototype[PATCH_STATE];
	}
	if (typeof prototype.renderToken !== "function") {
		return { installed: false as const, reason: "Pi Markdown.renderToken is unavailable" };
	}

	const original = prototype.renderToken;
	let state!: PatchState;
	const patched: RenderToken = function (token, width, nextTokenType, styleContext) {
		if (!state.enabled) {
			return original.call(this, token, width, nextTokenType, styleContext);
		}
		if (
			typeof token !== "object" ||
			token === null ||
			(token as { type?: unknown }).type !== "code" ||
			typeof (token as { text?: unknown }).text !== "string" ||
			width < 4
		) {
			return original.call(this, token, width, nextTokenType, styleContext);
		}
		try {
			return renderCodeBlock(
				this as unknown as { theme: MarkdownTheme },
				token as CodeToken,
				width,
				nextTokenType,
				getRuntimeTheme(),
			);
		} catch {
			return original.call(this, token, width, nextTokenType, styleContext);
		}
	};
	state = { original, patched, enabled: true };
	prototype.renderToken = patched;
	prototype[PATCH_STATE] = state;
	return { installed: true as const };
}

function restoreRenderer(): void {
	const prototype = Markdown.prototype as unknown as MarkdownRuntime;
	const state = prototype[PATCH_STATE];
	if (!isPatchState(state)) return;
	state.enabled = false;
	if (prototype.renderToken === state.patched) {
		prototype.renderToken = state.original;
		delete prototype[PATCH_STATE];
	}
}

function requestedIndex(args: unknown): number {
	const value = String(args ?? "").trim();
	return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) - 1 : 0;
}

export default function piMarkdownBlocks(pi: ExtensionAPI): void {
	let blocks: CopyBlock[] = [];
	let context: ExtensionContext | undefined;
	const patch = installRenderer(() => context?.ui.theme);

	const restore = (nextContext: ExtensionContext) => {
		context = nextContext;
		blocks = restoreBlocks(nextContext);
	};
	const copy = async (block: CopyBlock, nextContext: ExtensionContext) => {
		try {
			await copyToClipboard(block.content);
			const lines = block.content.split("\n").length;
			nextContext.ui.notify(
				`Copied ${block.language} block (${lines} line${lines === 1 ? "" : "s"})`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			nextContext.ui.notify(`Could not copy fenced block: ${message}`, "error");
		}
	};

	pi.on("session_start", async (_event, nextContext) => {
		restore(nextContext);
		if (!patch.installed) {
			nextContext.ui.notify(`pi-markdown-blocks renderer disabled: ${patch.reason}`, "warning");
		}
	});
	pi.on("session_tree", async (_event, nextContext) => restore(nextContext));
	pi.on("session_shutdown", async () => {
		blocks = [];
		context = undefined;
		restoreRenderer();
	});
	pi.on("message_end", async (event, nextContext) => {
		context = nextContext;
		if (event.message.role === "assistant") blocks = extractBlocks(event.message.content);
	});

	pi.registerShortcut(Key.alt("c"), {
		description: "Copy a fenced block from the latest assistant response",
		handler: async (nextContext) => {
			context = nextContext;
			if (!nextContext.hasUI) return;
			if (!blocks.length) {
				nextContext.ui.notify("No fenced blocks in the latest assistant response", "error");
				return;
			}
			const labels = blocks.map(pickerLabel);
			const choice = await nextContext.ui.select("Copy fenced block:", labels);
			const index = choice ? labels.indexOf(choice) : -1;
			if (index >= 0) await copy(blocks[index], nextContext);
		},
	});

	const copyByIndex = async (args: string, nextContext: ExtensionContext) => {
		context = nextContext;
		const block = blocks[requestedIndex(args)];
		if (!block) {
			nextContext.ui.notify(
				blocks.length
					? `Latest assistant response has ${blocks.length} fenced block(s)`
					: "No fenced blocks in the latest assistant response",
				"error",
			);
			return;
		}
		await copy(block, nextContext);
	};

	pi.registerCommand("copyblock", {
		description: "Copy the nth fenced block from the latest assistant response (default: 1)",
		handler: copyByIndex,
	});
}
