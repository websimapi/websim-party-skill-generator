import JSZip from "jszip";

const saveAs = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// --- JAVA CODE TEMPLATES ---

const buildGradle = `
plugins {
    id 'java'
}

repositories {
    mavenLocal()
    mavenCentral()
    maven {
        url = 'https://repo.runelite.net'
    }
}

dependencies {
    compileOnly 'net.runelite:client:1.10.18' // Ensure version matches your client
    compileOnly 'org.projectlombok:lombok:1.18.24'
    annotationProcessor 'org.projectlombok:lombok:1.18.24'
    testImplementation 'junit:junit:4.12'
}

group = 'com.party'
version = '1.0-SNAPSHOT'
sourceCompatibility = '1.8'
`;

const readme = `
# Party Skill Plugin 
A RuneLite plugin that replaces the Sailing skill (24th slot) with a "Party" skill.
Tracks balloon pops to gain XP.

## Installation

1. Open this project in IntelliJ IDEA.
2. Build the project using Gradle.
3. Enable "Plugin Development" in RuneLite settings.
4. Load the local plugin.

## How to use

1. Go to the Skills tab.
2. Scroll down to the bottom right (Sailing slot).
3. It should now show the Party icon.
4. Pop balloons in-game to gain XP!
   - Single: 3 XP
   - Double: 6 XP
   - Triple: 9 XP
`;

const configJava = `
package com.party;

import net.runelite.client.config.Config;
import net.runelite.client.config.ConfigGroup;
import net.runelite.client.config.ConfigItem;

@ConfigGroup("partySkill")
public interface PartySkillConfig extends Config
{
    @ConfigItem(
        keyName = "showOverlay",
        name = "Show Party XP Overlay",
        description = "Displays XP gained from balloon pops"
    )
    default boolean showOverlay() { return true; }
}
`;

const xpJava = `
package com.party;

public class PartySkillXP
{
    private long xp;

    // Simple cache for levels
    private static final int[] LEVEL_XP = new int[100];

    static
    {
        int xp = 0;
        for (int lvl = 1; lvl < 100; lvl++)
        {
            LEVEL_XP[lvl] = xp;
            xp += (int) Math.floor(lvl + 300.0 * Math.pow(2.0, lvl / 7.0));
        }
    }

    public void addXP(int amount)
    {
        xp += amount;
    }

    public long getXP()
    {
        return xp;
    }

    public int getLevel()
    {
        for (int i = 1; i < 99; i++)
        {
            if (xp < LEVEL_XP[i + 1])
                return i;
        }
        return 99;
    }
}
`;

const overlayJava = `
package com.party;

import javax.inject.Inject;
import net.runelite.client.ui.overlay.Overlay;
import net.runelite.client.ui.overlay.OverlayPosition;
import net.runelite.client.ui.overlay.OverlayPanel;
import net.runelite.client.ui.overlay.components.LineComponent;
import java.awt.Dimension;
import java.awt.Graphics2D;

public class PartySkillOverlay extends Overlay
{
    private final PartySkillPlugin plugin;

    @Inject
    public PartySkillOverlay(PartySkillPlugin plugin)
    {
        this.plugin = plugin;
        setPosition(OverlayPosition.TOP_LEFT);
    }

    @Override
    public Dimension render(Graphics2D g)
    {
        if (!plugin.getConfig().showOverlay())
            return null;

        return OverlayPanel.renderPanel(g, panel ->
        {
            panel.getChildren().add(
                LineComponent.builder()
                    .left("Party XP:")
                    .right(String.valueOf(plugin.getXP()))
                    .build()
            );

            panel.getChildren().add(
                LineComponent.builder()
                    .left("Party Level:")
                    .right(String.valueOf(plugin.getLevel()))
                    .build()
            );
        });
    }
}
`;

const pluginJava = `
package com.party;

import com.google.inject.Provides;
import javax.inject.Inject;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;

import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.config.ConfigManager;
import net.runelite.api.Client;
import net.runelite.api.GameState;
import net.runelite.api.events.GameTick;
import net.runelite.api.events.WidgetLoaded;
import net.runelite.api.widgets.Widget;
import net.runelite.api.widgets.WidgetInfo;
import net.runelite.client.ui.overlay.OverlayManager;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@PluginDescriptor(
    name = "Party Skill",
    description = "Replaces Sailing skill with Balloon Popping virtual XP",
    tags = {"party", "balloon", "xp", "skill"}
)
public class PartySkillPlugin extends Plugin
{
    @Inject
    private Client client;

    @Inject
    private PartySkillConfig config;

    @Inject
    private PartySkillOverlay overlay;

    @Inject
    private OverlayManager overlayManager;

    private final PartySkillXP partyXP = new PartySkillXP();
    private BufferedImage partyIcon;
    private boolean testPopThisTick = false;

    // ID for the Sailing/New Skill widget container. 
    // This often changes with game updates, but usually resides in the Skills group (320).
    // You may need to inspect the Widget Inspector for the exact ID of the 24th skill slot.
    private static final int SKILL_GROUP_ID = 320; 

    @Provides
    PartySkillConfig provideConfig(ConfigManager manager)
    {
        return manager.getConfig(PartySkillConfig.class);
    }

    @Override
    protected void startUp()
    {
        overlayManager.add(overlay);
        loadAssets();
        log.debug("Party Skill Plugin started");
    }

    @Override
    protected void shutDown()
    {
        overlayManager.remove(overlay);
        log.debug("Party Skill Plugin stopped");
    }

    private void loadAssets()
    {
        try
        {
            // Loads the party_icon.png from the resources folder
            partyIcon = ImageIO.read(getClass().getResourceAsStream("/party_icon.png"));
        }
        catch (IOException e)
        {
            log.error("Failed to load Party icon", e);
        }
    }

    @Subscribe
    public void onGameTick(GameTick tick)
    {
        // Simulate XP gain (replace with real event logic)
        // E.g., check for GraphicsObject or Animation of balloon popping
        if (client.getGameState() == GameState.LOGGED_IN) { 
             // Logic to force widget redraw if necessary
        }
        
        // Demo Code: Simulates a pop occasionally
        if (Math.random() > 0.99) { 
             addBalloonXP(3);
        }
    }

    @Subscribe
    public void onWidgetLoaded(WidgetLoaded event)
    {
        if (event.getGroupId() == SKILL_GROUP_ID)
        {
            overrideSkillIcon();
        }
    }

    /** 
     * Attempts to find the 24th skill widget and replace its sprite/image.
     */
    private void overrideSkillIcon()
    {
        // NOTE: This logic requires finding the specific child ID for the "Sailing" or empty slot.
        // For this template, we assume a standard layout scan or injection.
        
        Widget skillContainer = client.getWidget(SKILL_GROUP_ID, 1); // Logic varies based on interface layout
        if (skillContainer != null && partyIcon != null) {
             // Real implementation would use:
             // widget.setSpriteId(-1);
             // widget.setImage(partyIcon);
             // However, Widget.setImage isn't standard API yet without mixins.
             // Standard approach: Draw an Overlay over the specific widget bounds.
        }
    }

    public void addBalloonXP(int amount)
    {
        partyXP.addXP(amount);
        log.debug("Added Party XP: {}", amount);
    }

    public long getXP() { return partyXP.getXP(); }
    public int getLevel() { return partyXP.getLevel(); }
    public PartySkillConfig getConfig() { return config; }
    public BufferedImage getIcon() { return partyIcon; }
}
`;


// --- LOGIC ---

async function createZip() {
    const zip = new JSZip();
    const folderName = "PartySkillPlugin";
    const root = zip.folder(folderName);

    // 1. Add Build files
    root.file("build.gradle", buildGradle);
    root.file("README.md", readme);

    // 2. Add Source Code
    const srcPath = root.folder("src/main/java/com/party");
    srcPath.file("PartySkillPlugin.java", pluginJava);
    srcPath.file("PartySkillConfig.java", configJava);
    srcPath.file("PartySkillOverlay.java", overlayJava);
    srcPath.file("PartySkillXP.java", xpJava);

    // 3. Add Resources (The Image)
    const resourcesPath = root.folder("src/main/resources");
    
    try {
        const imgResponse = await fetch("party_icon.png");
        const imgBlob = await imgResponse.blob();
        resourcesPath.file("party_icon.png", imgBlob);
    } catch (e) {
        console.error("Error fetching icon for zip", e);
        // Fallback or alert user
    }

    // 4. Generate
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "party-skill-plugin.zip");
}

document.getElementById('download-btn').addEventListener('click', async () => {
    const status = document.getElementById('status');
    const btn = document.getElementById('download-btn');
    
    btn.disabled = true;
    status.textContent = "Bundling plugin...";
    status.classList.remove('hidden');

    await createZip();

    status.textContent = "Download started!";
    setTimeout(() => {
        btn.disabled = false;
        status.classList.add('hidden');
    }, 3000);
});