const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const FormData = require('form-data');
const fetch = require('node-fetch');
const cors = require('cors');

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
        
        if (response.status === 401) {
            console.log('❌ Token Netlify INVALIDE !');
        } else if (response.status === 200) {
            const data = await response.json();
            console.log('✅ Token Netlify VALIDE');
            console.log(`📊 ${data.length} site(s) trouvé(s) sur ton compte Netlify`);
        }
    } catch (error) {
        console.log('❌ Erreur de connexion à Netlify :', error.message);
    }
}
testNetlifyToken();

// Endpoint de déploiement
app.post('/deploy', upload.array('files'), async (req, res) => {
    console.log('\n🚀 Nouvelle demande de déploiement');
    console.log(`📁 Nombre de fichiers reçus : ${req.files.length}`);
    
    try {
        const files = req.files;
        const tempId = uuidv4();
        const tempDir = `temp/${tempId}`;
        
        // 1. Créer le dossier temporaire
        fs.mkdirSync(tempDir, { recursive: true });
        
        // 2. Sauvegarder les fichiers
        for (const file of files) {
            const originalPath = file.originalname;
            const targetPath = path.join(tempDir, originalPath);
            const targetDir = path.dirname(targetPath);
            
            fs.mkdirSync(targetDir, { recursive: true });
            fs.renameSync(file.path, targetPath);
        }
        
        // 3. Créer le ZIP
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
        
        // 4. Envoyer à Netlify
        const formData = new FormData();
        formData.append('file', fs.createReadStream(zipPath));
        
        const response = await fetch('https://api.netlify.com/api/v1/sites', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NETLIFY_TOKEN}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        // 5. CORRECTION ICI : Récupérer l'URL correctement
        // Netlify ne renvoie plus "subdomain" mais "default_domain" ou "url"
        const siteUrl = data.ssl_url || data.url || `https://${data.default_domain}`;
        
        console.log(`✅ Site déployé : ${siteUrl}`);
        
        // 6. Nettoyer
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);
        
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
