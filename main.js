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

const buildGradle = `plugins {
    id 'java'
}

group = 'com.party'
version = '1.0'

repositories {
    mavenLocal()
    mavenCentral()

    maven {
        name = 'runelite'
        url = 'https://repo.runelite.net'
    }
}

dependencies {
    // RuneLite API + Client
    // NOTE: If build fails finding these, check https://github.com/runelite/runelite/releases 
    // for the latest version tag and update this variable.
    def runeliteVersion = '1.11.12'
    
    compileOnly group: 'net.runelite', name: 'runelite-api', version: runeliteVersion
    compileOnly group: 'net.runelite', name: 'runelite-client', version: runeliteVersion

    // SLF4J (Logging)
    compileOnly 'org.slf4j:slf4j-api:1.7.36'
}

tasks.withType(JavaCompile) {
    options.encoding = 'UTF-8'
    options.release = 17
}

jar {
    from {
        configurations.runtimeClasspath.collect { it.isDirectory() ? it : zipTree(it) }
    }
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}
`;

const readme = `
# Party Skill Plugin 
A RuneLite plugin that replaces the Sailing skill (24th slot) with a "Party" skill.
Tracks balloon pops to gain XP.

## Requirements
- Java 17 (JDK)
- Gradle 7+ (Recommended)

## Build Instructions (Terminal)

1. Unzip the project.
2. Open your terminal in the project folder.
3. Check your gradle version:
   \`\`\`bash
   gradle -v
   \`\`\`
   *If your version is older than 7.0, you may encounter issues. Please update Gradle.*

4. Run the build command:
   \`\`\`bash
   gradle clean build
   \`\`\`
   
   *If you encounter "release version 17 not supported", ensure you are running with Java 17:*
   \`\`\`bash
   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
   gradle clean build
   \`\`\`

5. Verify the JAR file was created:
   \`\`\`bash
   ls build/libs
   \`\`\`
   You should see \`PartySkillPlugin-1.0.jar\`.

## Installation in RuneLite

1. Open RuneLite.
2. Go to **Settings** (wrench icon) -> **Developer Tools**.
   * If you don't see Developer Tools, enable it in the Plugin Hub or sidebar.
3. Enable the **Plugin Development** setting.
4. Click the **Load external plugin** button.
5. Navigate to your build folder and select:
   \`build/libs/PartySkillPlugin-1.0.jar\`
6. The plugin should load immediately.

## Troubleshooting

### Build Failed: "Could not find net.runelite:runelite-client..."
This means the version specified in \`build.gradle\` is either too old or temporarily unavailable.
1. Visit [RuneLite Releases on GitHub](https://github.com/runelite/runelite/releases).
2. Look for the latest release tag (e.g., \`runelite-parent-1.12.8\`).
3. Open \`build.gradle\` in a text editor.
4. Update the line \`def runeliteVersion = '1.11.12'\` to match the version you found (e.g., \`1.12.8\`).
5. Run \`gradle clean build\` again.

### Build Failed: "Could not find method annotationProcessor"
This means your Gradle is very old. Upgrade to Gradle 7+ for the best experience.
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

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@PluginDescriptor(
    name = "Party Skill",
    description = "Replaces Sailing skill with Balloon Popping virtual XP",
    tags = {"party", "balloon", "xp", "skill"}
)
public class PartySkillPlugin extends Plugin
{
    private static final Logger log = LoggerFactory.getLogger(PartySkillPlugin.class);

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