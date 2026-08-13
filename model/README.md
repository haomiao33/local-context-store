---
license: apache-2.0
language:
- en
base_model:
- sentence-transformers/all-MiniLM-L6-v2
pipeline_tag: sentence-similarity
library_name: transformers.js
datasets:
  - s2orc
  - flax-sentence-embeddings/stackexchange_xml
  - ms_marco
  - gooaq
  - yahoo_answers_topics
  - code_search_net
  - search_qa
  - eli5
  - snli
  - multi_nli
  - wikihow
  - natural_questions
  - trivia_qa
  - embedding-data/sentence-compression
  - embedding-data/flickr30k-captions
  - embedding-data/altlex
  - embedding-data/simple-wiki
  - embedding-data/QQP
  - embedding-data/SPECTER
  - embedding-data/PAQ_pairs
  - embedding-data/WikiAnswers
tags:
- feature-extraction
---

https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 with ONNX weights to be compatible with Transformers.js.

## Usage (Transformers.js)

If you haven't already, you can install the [Transformers.js](https://huggingface.co/docs/transformers.js) JavaScript library from [NPM](https://www.npmjs.com/package/@huggingface/transformers) using:
```bash
npm i @huggingface/transformers
```

You can then use the model to compute embeddings like this:

```js
import { pipeline } from '@huggingface/transformers';

// Create a feature-extraction pipeline
const extractor = await pipeline('feature-extraction', 'onnx-community/all-MiniLM-L6-v2-ONNX');

// Compute sentence embeddings
const sentences = ['This is an example sentence', 'Each sentence is converted'];
const output = await extractor(sentences, { pooling: 'mean', normalize: true });
console.log(output);
// Tensor {
//   dims: [ 2, 384 ],
//   type: 'float32',
//   data: Float32Array(768) [ 0.04592696577310562, 0.07328180968761444, ... ],
//   size: 768
// }
```

You can convert this Tensor to a nested JavaScript array using `.tolist()`:
```js
console.log(output.tolist());
// [
//   [ 0.04592696577310562, 0.07328180968761444, 0.05400655046105385, ... ],
//   [ 0.08188057690858841, 0.10760223120450974, -0.013241755776107311, ... ]
// ]
```
