import os
import getpass
import json
from pathlib import Path
from sentence_transformers import SentenceTransformer
from torch.utils.data import DataLoader
from torch.utils.data import Dataset
from sentence_transformers import InputExample
from sentence_transformers.losses import MatryoshkaLoss, MultipleNegativesRankingLoss
from sentence_transformers.evaluation import InformationRetrievalEvaluator
import wandb
from huggingface_hub import login
import uuid

BATCH_SIZE = 10
EPOCHS = 10
HF_USERNAME = "cantemizyurek"
MODEL_ID = "Snowflake/snowflake-arctic-embed-l"

project_root = Path(__file__).parents[2]

train_set_path = project_root / "data" / "embed" / "training-set.json"
test_set_path = project_root / "data" / "embed" / "test-set.json"
validation_set_path = project_root / "data" / "embed" / "validation-set.json"
questions_path = project_root / "data" / "embed" / "questions.json"

with open(train_set_path, 'r') as f:
    train_set_data = json.load(f)

with open(validation_set_path, 'r') as f:
    validation_set_data = json.load(f)

with open(test_set_path, 'r') as f:
    test_set_data = json.load(f)

with open(questions_path, 'r') as f:
    questions_data = json.load(f)

print(f"Loaded train set with {len(train_set_data)} items")
print(f"Loaded validation set with {len(validation_set_data)} items")
print(f"Loaded test set with {len(test_set_data)} items")
print(f"Loaded questions with {len(questions_data)} items")

questions_object = {}
context_object = {}
corpus_object = {}
for doc_id, questions in questions_data.items():
    for index, question in enumerate(questions):
        questions_object[f"{doc_id}_{index}"] = question
        context_object[f"{doc_id}_{index}"] = [doc_id]
        corpus_object[doc_id] = next((item for item in train_set_data if item['id'] == doc_id), None)["content"]

train_dataset = {
    "question": questions_object,
    "context": context_object,
    "corpus": corpus_object
}

print("Creating Examples")

examples = []
for query_id, question in questions_object.items():
    doc_id = context_object[query_id][0]
    text = corpus_object[doc_id]
    examples.append(InputExample(texts=[question, text]))

print(f"Created {len(examples)} examples")

print("Creating DataLoader")
loader = DataLoader(
    examples, batch_size=BATCH_SIZE
)
print("Created DataLoader")

print("Loading Model")
model = SentenceTransformer(MODEL_ID)
print("Loaded Model")

print("Creating Train Loss")
matryoshka_dimensions = [768, 512, 256, 128, 64]
inner_train_loss = MultipleNegativesRankingLoss(model)
train_loss = MatryoshkaLoss(
    model, inner_train_loss, matryoshka_dims=matryoshka_dimensions
)
print("Created Train Loss")

evaluator = InformationRetrievalEvaluator(
    train_dataset["question"],
    train_dataset["corpus"],
    train_dataset["context"]
)
print("Created Evaluator")

print("Initializing WandB")
wandb.init(mode="disabled")

print("Starting Training")

warmup_steps = int(len(loader) * EPOCHS * 0.1)
model.fit(
    train_objectives=[(loader, train_loss)],
    epochs=EPOCHS,
    warmup_steps=warmup_steps,
    show_progress_bar=True,
    output_path="finetuned_arctic_ft",
    evaluator=evaluator,
    evaluation_steps=50
)

print("Training Complete")

token = os.environ.get("HF_TOKEN")
login(token=token)

model.push_to_hub(f"{HF_USERNAME}/legal-ft-{uuid.uuid4()}")