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

// ===== TEST AU DÉMARRAGE =====
async function testNetlifyToken() {
    console.log('🔍 Test du token Netlify...');
    console.log('Token présent :', NETLIFY_TOKEN ? 'OUI' : 'NON');
    
    if (!NETLIFY_TOKEN) {
        console.log('❌ ERREUR : Token Netlify manquant !');
        console.log('💡 Ajoute NETLIFY_TOKEN dans les variables Railway');
        return;
    }
    
    try {
        const response = await fetch('https://api.netlify.com/api/v1/sites', {
            headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` }
        });
        
        console.log('📡 Réponse API Netlify :', response.status);
        
        if (response.status === 401) {
            console.log('❌ Token Netlify INVALIDE !');
            console.log('💡 Régénère un token sur app.netlify.com/user/applications');
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

// ===== ENDPOINT DE DÉPLOIEMENT =====
app.post('/deploy', upload.array('files'), async (req, res) => {
    console.log('\n🚀 Nouvelle demande de déploiement');
    console.log(`📁 Nombre de fichiers reçus : ${req.files.length}`);
    
    try {
        const files = req.files;
        const tempId = uuidv4();
        const tempDir = `temp/${tempId}`;
        
        // 1. Créer le dossier temporaire
        fs.mkdirSync(tempDir, { recursive: true });
        console.log(`📂 Dossier temporaire créé : ${tempDir}`);
        
        // 2. Sauvegarder les fichiers avec leur structure
        for (const file of files) {
            const originalPath = file.originalname;
            const targetPath = path.join(tempDir, originalPath);
            const targetDir = path.dirname(targetPath);
            
            fs.mkdirSync(targetDir, { recursive: true });
            fs.renameSync(file.path, targetPath);
            console.log(`📄 Fichier sauvegardé : ${originalPath}`);
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
        
        const zipStats = fs.statSync(zipPath);
        console.log(`📦 ZIP créé : ${zipPath} (${zipStats.size} octets)`);
        
        // 4. Envoyer à Netlify - VERSION CORRIGÉE
        const formData = new FormData();
        // La clé doit être "file" et on ajoute un nom de fichier explicite
        formData.append('file', fs.createReadStream(zipPath), 'site.zip');
        
        console.log('📤 Envoi à Netlify...');
        
        const response = await fetch('https://api.netlify.com/api/v1/sites', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NETLIFY_TOKEN}`
            },
            body: formData
        });
        
        console.log(`📡 Réponse Netlify : ${response.status} ${response.statusText}`);
        
        const data = await response.json();
        console.log('📄 Réponse complète :', JSON.stringify(data, null, 2));
        
        // 5. Vérifier la réponse
        if (!response.ok) {
            throw new Error(`Netlify API error: ${response.status} - ${JSON.stringify(data)}`);
        }
        
        // 6. Récupérer l'URL (différents formats possibles)
        const siteUrl = data.ssl_url || data.url || `https://${data.default_domain}`;
        
        if (!siteUrl) {
            throw new Error(`Impossible de trouver l'URL du site. Réponse: ${JSON.stringify(data)}`);
        }
        
        console.log(`✅ Site déployé avec succès : ${siteUrl}`);
        
        // 7. Nettoyer les fichiers temporaires
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);
        console.log(`🧹 Nettoyage effectué`);
        
        // 8. Réponse au client
        res.json({ success: true, url: siteUrl });
        
    } catch (error) {
        console.error('❌ ERREUR :', error.message);
        console.error('📚 Stack:', error.stack);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ===== ENDPOINT DE TEST =====
app.get('/', (req, res) => {
    res.json({ message: 'HostMaker API fonctionne' });
});

// ===== DÉMARRAGE =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Serveur démarré sur le port ${PORT}`);
    console.log(`🌐 URL de test : http://localhost:${PORT}`);
});
