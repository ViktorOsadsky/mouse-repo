# Mouse Age Atlas website

This is a Vercel-ready cohort explorer with three tabs: dataset overview,
interactive plasma protein plot, and chronological-age estimator. It offers
two prediction paths:

- A behavior-only estimator using seven measurements, sex, and line. It blends
  a boosted model with a linear model for smoother input responses.
- The original plasma-plus-behavior neural network, using a long-format plasma
  CSV (`PG.ProteinAccessions,PG.Quantity`) and one-row behavior CSV.

Neither model estimates age at death or remaining lifespan. `Age_month` in the
supplied workbooks is age at measurement; some mouse IDs appear at multiple ages.
The public `data/results.json` file contains cohort aggregates. The
`data/explorer.json` catalog lists all 3,983 proteins used by the model and
the matched sample metadata, including mouse IDs and batches. The
`data/proteins/` files contain normalized log2 signal values for every
detected protein/sample pair. These files load on demand when a visitor selects
a protein. The original plasma quantity matrix and phenotype workbook remain
outside `web/`. The plot can be downloaded as an SVG.
The protein selector renders up to 100 names at a time; searching reaches all
3,983 proteins without asking the browser to open a 3,983-item native menu.

## Local review

From the local `Mouse` folder, after installing the root `requirements.txt`:

```powershell
.\.venv\Scripts\python.exe web\dev_server.py
```

Open `http://127.0.0.1:8000`. The behavior template and plasma template are
downloadable from the upload panel. Enter values from the same timepoint for a
single mouse. The plasma file should contain positive raw quantities; the API
applies the training-time log transform, median normalization, imputation, and
scaling. The server does not persist submitted measurements.

## Vercel

The simplest deployment repository contains the **contents of this `web` folder
at its root**. Import that GitHub repository into Vercel, keep **Root Directory**
at the default (`./`), choose the **Other** framework preset, and leave the
build command blank. If instead you make the entire local `Mouse` folder one
GitHub repository, set Vercel's **Root Directory** to `web`.

Vercel serves `index.html` and the static assets, and runs
`api/predict.py` as a Python function. Its deployment dependencies are pinned
in `web/requirements.txt`. The function uses NumPy for the exported neural
network weights, avoiding TensorFlow in the deployment. The raw cohort files
and local training environment are excluded by the repository `.gitignore`.
The exported model files are served from `web/models` and executed by the
site's Python function, so no separate model host is needed.

After deployment, check the homepage, hover over chart marks, and submit a
behavior-form example. The function endpoint should return a JSON prediction
from `/api/predict`.

To regenerate the site data and model artifacts after retraining, run
`prepare_web_models.py` and `prepare_explorer_data.py` from the parent local
`Mouse` folder. The model summary and plot data should be updated together if
a new cohort or split is used. See `../paper_readiness.md` for the current
statistical review and limits.
