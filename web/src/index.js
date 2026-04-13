const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Replicator Web Running');
});

// read configs
app.get('/config', (req, res) => {
    try {
        const mma = fs.readFileSync('/app/data/mma/config.yaml', 'utf-8');
        const rep = fs.readFileSync('/app/data/replicator/config.yaml', 'utf-8');

        res.json({ mma, replicator: rep });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.listen(8080, () => {
    console.log('Web running on 8080');
});