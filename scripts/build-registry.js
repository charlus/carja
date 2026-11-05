import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const agentsDir = path.join(__dirname, '..', 'templates', '.agents');
const registryFile = path.join(agentsDir, 'registry.json');

function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const yaml = match[1];
    const data = {};
    for (const line of yaml.split('\n')) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > -1) {
            const key = line.slice(0, colonIndex).trim();
            let value = line.slice(colonIndex + 1).trim();
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
            if (value === 'true') value = true;
            if (value === 'false') value = false;
            data[key] = value;
        }
    }
    return data;
}

function scanDirectory(baseDir, type) {
    const items = [];
    if (!fs.existsSync(baseDir)) return items;

    if (type === 'skills') {
        // Skills are directories
        const dirs = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const dir of dirs) {
            if (dir.isDirectory()) {
                const skillMd = path.join(baseDir, dir.name, 'SKILL.md');
                if (fs.existsSync(skillMd)) {
                    const content = fs.readFileSync(skillMd, 'utf8');
                    const fm = parseFrontmatter(content);
                    items.push({
                        name: fm.name || dir.name,
                        dir: dir.name,
                        description: fm.description || '',
                        category: fm.category || 'core',
                        default: fm.default !== undefined ? fm.default : true
                    });
                }
            }
        }
    } else {
        // Rules and Workflows are files
        const files = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const file of files) {
            if (file.isFile() && file.name.endsWith('.md')) {
                const content = fs.readFileSync(path.join(baseDir, file.name), 'utf8');
                const fm = parseFrontmatter(content);
                const name = fm.name || file.name.replace(/\.md$/, '');
                items.push({
                    name: name,
                    file: file.name,
                    description: fm.description || '',
                    category: fm.category || 'core',
                    default: fm.default !== undefined ? fm.default : true
                });
            }
        }
    }
    return items;
}

function buildRegistry() {
    console.log('Building registry.json...');
    const skills = scanDirectory(path.join(agentsDir, 'skills'), 'skills');
    const rules = scanDirectory(path.join(agentsDir, 'rules'), 'rules');
    const workflows = scanDirectory(path.join(agentsDir, 'workflows'), 'workflows');

    const registry = {
        skills,
        rules,
        workflows,
        bundles: [
            {
                name: 'core',
                description: 'Core carja framework capabilities',
                skills: skills.map(s => s.name),
                rules: rules.map(r => r.name),
                workflows: workflows.map(w => w.name)
            }
        ]
    };

    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n');
    console.log(`✅ Wrote registry.json with ${skills.length} skills, ${rules.length} rules, ${workflows.length} workflows.`);
}

buildRegistry();
