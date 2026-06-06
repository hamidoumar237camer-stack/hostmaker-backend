const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const FormData = require('form-data');
const fetch = require('node-fetch');
const cors = require('cors');
const AdmZip = require('adm-zip');

const app = express();
const upload = multer({ dest: 'uploads/' });

const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;

app.use(cors());
app.use(express.json());

// Test du token au démarrage
async function testNetlifyToken() {
    console.log('🔍 Test du token Netlify...');
    console.log('Token présent :', NETLIFY_TOKEN ? 'OUI' : 'NON');
    
    if (!NETLIFY_TOKEN) {
        console.log('❌ ERREUR : Token Netlify manquant !');
        return;
    }
    
    try {
        const response = await fetch('https://api.netlify.com/api/v1/sites', {
            headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` }
        });
        
        console.log('📡 Réponse API Netlify :', response.status);
        
        if (response.status === 200) {
            const data = await response.json();
            console.log('✅ Token Netlify VALIDE');
            console.log(`📊 ${data.length} site(s) trouvé(s)`);
        } else {
            console.log('❌ Token Netlify INVALIDE');
        }
    } catch (error) {
        console.log('❌ Erreur :', error.message);
    }
}
testNetlifyToken();

// Fonction pour extraire les fichiers d'un ZIP
async function extractZip(zipPath, outputDir) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    
    for (const entry of entries) {
        if (!entry.isDirectory) {
            const filePath = path.join(outputDir, entry.entryName);
            const fileDir = path.dirname(filePath);
            
            if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir, { recursive: true });
            }
            
            fs.writeFileSync(filePath, entry.getData());
            console.log(`📄 Fichier extrait : ${entry.entryName}`);
        }
    }
}

// Endpoint de déploiement
app.post('/deploy', upload.array('files'), async (req, res) => {
    console.log('\n🚀 Nouvelle demande de déploiement');
    console.log(`📁 Nombre de fichiers reçus : ${req.files.length}`);
    
    try {
        const files = req.files;
        const tempId = uuidv4();
        const tempDir = `temp/${tempId}`;
        
        fs.mkdirSync(tempDir, { recursive: true });
        
        // Vérifier si c'est un ZIP ou des fichiers individuels
        const isZipFile = files.length === 1 && files[0].originalname.endsWith('.zip');
        
        if (isZipFile) {
            console.log('📦 Fichier ZIP détecté, extraction en cours...');
            const zipPath = files[0].path;
            await extractZip(zipPath, tempDir);
            // Supprimer le ZIP original après extraction
            fs.unlinkSync(zipPath);
        } else {
            // Fichiers individuels
            for (const file of files) {
                const originalPath = file.originalname;
                const targetPath = path.join(tempDir, originalPath);
                const targetDir = path.dirname(targetPath);
                
                fs.mkdirSync(targetDir, { recursive: true });
                fs.renameSync(file.path, targetPath);
                console.log(`📄 Fichier sauvegardé : ${originalPath}`);
            }
        }
        
        // Vérifier la présence de index.html
        let hasIndex = false;
        function findIndex(dir) {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                if (fs.statSync(fullPath).isDirectory()) {
                    findIndex(fullPath);
                } else if (item === 'index.html') {
                    hasIndex = true;
                    console.log(`✅ index.html trouvé à : ${fullPath}`);
                }
            }
        }
        findIndex(tempDir);
        
        if (!hasIndex) {
            throw new Error('Aucun fichier index.html trouvé dans le dossier ou ZIP');
        }
        
        // Créer le ZIP final pour Netlify
        const zipPath = `${tempDir}.zip`;
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(tempDir, false);
            archive.finalize();
        });
        
        // Envoyer à Netlify
        const formData = new FormData();
        formData.append('file', fs.createReadStream(zipPath), 'site.zip');
        
        const response = await fetch('https://api.netlify.com/api/v1/sites', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NETLIFY_TOKEN}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Netlify error: ${response.status} - ${JSON.stringify(data)}`);
        }
        
        const siteUrl = data.ssl_url || data.url || `https://${data.default_domain}`;
        
        // Nettoyer
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);
        
        console.log(`✅ Site déployé : ${siteUrl}`);
        res.json({ success: true, url: siteUrl });
        
    } catch (error) {
        console.error('❌ ERREUR :', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ message: 'HostMaker API fonctionne' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Serveur démarré sur le port ${PORT}`);
});
