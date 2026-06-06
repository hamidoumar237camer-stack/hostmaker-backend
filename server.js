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

app.post('/deploy', upload.array('files'), async (req, res) => {
    try {
        const files = req.files;
        const tempId = uuidv4();
        const tempDir = `temp/${tempId}`;
        
        fs.mkdirSync(tempDir, { recursive: true });
        
        for (const file of files) {
            const originalPath = file.originalname;
            const targetPath = path.join(tempDir, originalPath);
            const targetDir = path.dirname(targetPath);
            
            fs.mkdirSync(targetDir, { recursive: true });
            fs.renameSync(file.path, targetPath);
        }
        
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
        const siteUrl = `https://${data.subdomain}.netlify.app`;
        
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);
        
        res.json({ success: true, url: siteUrl });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ message: 'HostMaker API fonctionne' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
