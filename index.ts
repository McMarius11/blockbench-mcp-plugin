/**
 * @author jasonjgardner (upstream)
 * @author McMarius11 (mcmarius/extensions fork — 30+ added tools)
 * @discord jason.gardner
 * @github upstream: https://github.com/jasonjgardner/blockbench-mcp-plugin
 * @github fork:     https://github.com/McMarius11/blockbench-mcp-plugin
 */
/// <reference types="three" />
/// <reference types="blockbench-types" />
import { VERSION } from "@/lib/constants";
import { createServer } from "@/server/server";
import { tools, prompts } from "@/server/tools";
import { resources } from "@/server";
import { uiSetup, uiTeardown } from "@/ui";
import { settingsSetup, settingsTeardown } from "@/ui/settings";
import { setupI18n } from "@/ui/i18n";
import { sessionManager } from "@/lib/sessions";
import type { NetServer, SessionTransports } from "@/server/net";
import createNetServer from "@/server/net";
import { getIcon } from "@/macros/getIcon" with { type: "macro" };

let httpServer: NetServer | null = null;
let sessionTransports: SessionTransports | null = null;

BBPlugin.register("mcp", {
  version: VERSION,
  title: "MCP Server (McMarius11 fork)",
  author: "Jason J. Gardner (upstream) · McMarius11 (fork)",
  description:
    "Create an MCP server inside Blockbench. McMarius11 fork adds 30+ tools for AI-driven asset pipelines: silent file I/O, attachment points (Locator/NullObject), plugin hot-swap, animation CRUD, mesh inspector, topology selection, UV island transform.",
  tags: ["MCP", "AI", "Fork"],
  icon: getIcon(),
  variant: "desktop",
  async onload() {
    // Get network module with Blockbench permission handling
    // @ts-ignore - requireNativeModule is a Blockbench global
    const net = requireNativeModule("net", {
      message: "Network access is required for the MCP server to accept connections.",
      detail: "The MCP plugin needs to create a local server that AI assistants can connect to.",
      optional: false,
    });

    if (!net) {
      console.error("[MCP] Failed to get net module - server will not start");
      Blockbench.showQuickMessage("MCP Server requires network permission", 3000);
      return;
    }

    // Initialize internationalization before any UI
    setupI18n();

    settingsSetup();

    // Create TCP server to handle HTTP requests
    [httpServer, sessionTransports] = createNetServer(net, {
      port: Number(Settings.get("mcp_port") || 3000),
      endpoint: String(Settings.get("mcp_endpoint") || "/bb-mcp")
    });

    // Create a reference server for UI display purposes
    const referenceServer = createServer();
    uiSetup({
      server: referenceServer,
      tools,
      resources,
      prompts,
    });
  },

  onunload() {
    // Close HTTP server
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }

    // Close all session transports
    const values = Array.from(sessionTransports?.values() ?? []);
    for (const session of values) {
      session.transport.close();
    }
    sessionTransports?.clear();

    // Clear all sessions
    sessionManager.clear();

    uiTeardown();
    settingsTeardown();
  },

  oninstall() {
    Blockbench.showQuickMessage("Installed MCP Server plugin", 2000);
  },

  onuninstall() {
    Blockbench.showQuickMessage("Uninstalled MCP Server plugin", 2000);
    settingsTeardown();
  },
});
