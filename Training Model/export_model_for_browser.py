"""Export the trained scikit-learn random forest for in-browser inference."""

import json
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "src" / "model AI" / "bisara_final_model.joblib"
OUTPUT_PATH = ROOT / "public" / "models" / "sign_forest.json"


def main() -> None:
    bundle = joblib.load(MODEL_PATH)
    classifier = bundle["model"]
    trees = []
    for estimator in classifier.estimators_:
        tree = estimator.tree_
        values = np.asarray(tree.value[:, 0, :], dtype=np.float32)
        trees.append(
            {
                "left": tree.children_left.tolist(),
                "right": tree.children_right.tolist(),
                "feature": tree.feature.tolist(),
                "threshold": np.asarray(tree.threshold, dtype=np.float32).tolist(),
                "values": values.tolist(),
            }
        )

    payload = {
        "format": "bisara-random-forest-v1",
        "sequenceLength": int(bundle["sequence_length"]),
        "featureVersion": int(bundle["feature_version"]),
        "normalization": bundle["normalization"],
        "classes": [str(label) for label in classifier.classes_],
        "expectedHands": {str(label): int(count) for label, count in bundle["expected_hands"].items()},
        "trees": trees,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(payload, output, separators=(",", ":"), ensure_ascii=False)
    print(f"Model browser tersimpan: {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
