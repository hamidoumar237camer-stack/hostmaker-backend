const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const cors = require('cors');
const AdmZip = require('adm-zip');

const app = express();
const upload = multer({ dest: 'uploads/' });

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;

app.use(cors());
app.use(express.json());

// Test du token Vercel
async function testVercelToken() {
    console.log('🔍 Test du token Vercel...');
    console.log('Token présent :', VERCEL_TOKEN ? 'OUI' : 'NON');
    
    if (!VERCEL_TOKEN) {
        console.log('❌ ERREUR : Token Vercel manquant !');
        return;
    }
    
    try {
        const response = await fetch('https://api.vercel.com/v1/projects', {
            headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` }
        });
        
        console.log('📡 Réponse API Vercel :', response.status);
        
        if (response.status === 200) {
            console.log('✅ Token Vercel VALIDE');
        } else {
            console.log('❌ Token Vercel INVALIDE');
        }
    } catch (error) {
        console.log('❌ Erreur :', error.message);
    }
}
testVercelToken();

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

// Fonction pour encoder les fichiers en base64 pour Vercel
async function encodeFilesToBase64(dirPath, basePath = '') {
    const files = fs.readdirSync(dirPath);
    const fileList = [];
    
    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const relativePath = basePath ? `${basePath}/${file}` : file;
        
        if (fs.statSync(fullPath).isDirectory()) {
            const subFiles = await encodeFilesToBase64(fullPath, relativePath);
            fileList.push(...subFiles);
        } else {
            const content = fs.readFileSync(fullPath);
            fileList.push({
                file: relativePath,
                data: content.toString('base64')
            });
        }
    }
    return fileList;
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
            fs.unlinkSync(zipPath);
        } else {
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
        
        // Encoder les fichiers pour Vercel
        const encodedFiles = await encodeFilesToBase64(tempDir);
        
        // Créer un nom unique pour le déploiement
        const deploymentName = `hostmaker-${Date.now()}`;
        
        console.log('📤 Envoi à Vercel...');
        
        // API Vercel pour créer un déploiement
        const response = await fetch('https://api.vercel.com/v13/deployments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VERCEL_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: deploymentName,
                files: encodedFiles,
                projectSettings: {
                    framework: null,
                    buildCommand: null,
                    outputDirectory: '/',
                    installCommand: null
                }
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Vercel error: ${response.status} - ${JSON.stringify(data)}`);
        }
        
        // L'URL du site déployé
        const siteUrl = `https://${data.url}`;
        
        // Nettoyer
        fs.rmSync(tempDir, { recursive: true, force: true });
        
        console.log(`✅ Site déployé : ${siteUrl}`);
        res.json({ success: true, url: siteUrl });
        
    } catch (error) {
        console.error('❌ ERREUR :', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ message: 'HostMaker API fonctionne avec Vercel !' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Serveur démarré sur le port ${PORT}`);
    console.log('🌐 API prête pour Vercel');
});
