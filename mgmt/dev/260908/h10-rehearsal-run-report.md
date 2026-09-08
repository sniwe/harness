# Run report: audep-speed-local-260908

- Verdict: **PASS**
- Plan digest: `dbe18cd2b8ea6e62740595155cf2f92d6f628228a07eca90a953ae09063d9f34`
- Workflow status: `accepted`

## Steps

- A0: succeeded (A0:a0-observability); owner main-app; heartbeat 2026-09-08T11:55:47.462Z
- Q0: succeeded (Q0:q0-baseline); owner qwen-asr; heartbeat 2026-09-08T11:55:47.476Z
- A1: succeeded (A1:a1-byte-hash); owner main-app; heartbeat 2026-09-08T11:55:47.491Z
- Q1: succeeded (Q1:q1-long-poll); owner qwen-asr; heartbeat 2026-09-08T11:55:47.505Z
- A2A: succeeded (A2A:a2a-partial); owner main-app; heartbeat 2026-09-08T11:55:47.521Z
- A2B: succeeded (A2B:a2b-adoption); owner main-app; heartbeat 2026-09-08T11:55:47.534Z
- A3: succeeded (A3:a3-concurrency); owner main-app; heartbeat 2026-09-08T11:55:47.546Z
- A4: succeeded (A4:a4-browser); owner main-app; heartbeat 2026-09-08T11:55:47.557Z
- Q2: succeeded (Q2:q2-987); owner qwen-asr; heartbeat 2026-09-08T11:55:47.570Z
- Q3: succeeded (Q3:q3-correction); owner qwen-asr; heartbeat 2026-09-08T11:55:47.582Z
- Q4: succeeded (Q4:q4-quality-vram); owner qwen-asr; heartbeat 2026-09-08T11:55:47.595Z
- Q5: succeeded (Q5:q5-localization); owner qwen-asr; heartbeat 2026-09-08T11:55:47.608Z
- A5: succeeded (A5:a5-persistence); owner main-app; heartbeat 2026-09-08T11:55:47.619Z
- Q6: succeeded (Q6:q6-contract); owner qwen-asr; heartbeat 2026-09-08T11:55:47.631Z
- A6: succeeded (A6:a6-acceptance); owner main-app; heartbeat 2026-09-08T11:55:47.642Z
- Q7: succeeded (Q7:q7-final); owner qwen-asr; heartbeat 2026-09-08T11:55:47.656Z
- A7: succeeded (A7:a7-final); owner main-app; heartbeat 2026-09-08T11:55:47.669Z

## Evidence index

- A0: artifact `aa508c2187fca56f397ff75adc52b94e02f38122cdd48bd42105106e5e0f8e14`, verdict `pass`
- Q0: artifact `4d98893e06cf666506fff580b92c7ff22f41af5d5d0a98072d3a857291f074e7`, verdict `pass`
- A1: artifact `16a36e86f6fed5d465ff332511a0ce1a863b55d364b25a7cdaa25db19abf9648`, verdict `pass`
- Q1: artifact `32d833f348ce377c8cc3291cc520213770d5d519d7970540c1c36c4261c140cc`, verdict `pass`
- A2A: artifact `e4a92e1d1d6a52f6213dd5b4ee4b2051c33e87e400c16f5982c279c487e3a9e2`, verdict `pass`
- A2B: artifact `79cc85bec5cf3c5fa7796412b0da4b67452c6404e589da4127da0ef891b5ba24`, verdict `pass`
- A3: artifact `1398b376fdcce25c5a5399367e76891e85121c010ec919cc243b1a519d95bbc6`, verdict `pass`
- A4: artifact `4e808094851fc2eac7a386fc7d64677b34bda5e41d366ec4943233f9e6f2cd63`, verdict `pass`
- Q2: artifact `8845886be6cbcf285d18a66a83d622fdcf265ba4451ea2b2f4189ebf04eba915`, verdict `pass`
- Q3: artifact `9fc58f1abf0d4f134609c7572d4475fd5b6469591323164a998d435099198294`, verdict `pass`
- Q4: artifact `6866b00707ab48540b44bc72fdf9135e7d6e730895161c2d5aaea4bd22e5dd97`, verdict `pass`
- Q5: artifact `a08c925fed8ffd1710d3a4606109fcc3cf10d05a59c0ec9b52a6f81da4ed6d3b`, verdict `pass`
- A5: artifact `ea644b359f0b0abde72ab7dbdc03c7d630537bdd0fd7ca1bbb99d41e7f446eea`, verdict `pass`
- Q6: artifact `f8bdff3fb98849eac918743b4f18ec5d8bc343e2db664a92be4cefcc747c0c8f`, verdict `pass`
- A6: artifact `d94791a85f88d5f49c3cc06d5557316cf743d60149820c594f389a1b301ff021`, verdict `pass`
- Q7: artifact `0f27e1c3e3fbf06a3a4cd444c904212bfb4b16fc0999a7d48316421826d337e1`, verdict `pass`
- A7: artifact `724f7bdf7e74a5fe64337203fb8b6ccf4adfc2919665e67a81f02e81752c1c97`, verdict `pass`

## Trace

```json
[
  {
    "stepId": "A0",
    "state": "running"
  },
  {
    "stepId": "A0",
    "state": "succeeded"
  },
  {
    "stepId": "Q0",
    "state": "running"
  },
  {
    "stepId": "Q0",
    "state": "succeeded"
  },
  {
    "stepId": "A1",
    "state": "running"
  },
  {
    "stepId": "A1",
    "state": "succeeded"
  },
  {
    "stepId": "Q1",
    "state": "running"
  },
  {
    "stepId": "Q1",
    "state": "succeeded"
  },
  {
    "stepId": "A2A",
    "state": "running"
  },
  {
    "stepId": "A2A",
    "state": "succeeded"
  },
  {
    "stepId": "A2B",
    "state": "running"
  },
  {
    "stepId": "A2B",
    "state": "succeeded"
  },
  {
    "stepId": "A3",
    "state": "running"
  },
  {
    "stepId": "A3",
    "state": "succeeded"
  },
  {
    "stepId": "A4",
    "state": "running"
  },
  {
    "stepId": "A4",
    "state": "succeeded"
  },
  {
    "stepId": "Q2",
    "state": "running"
  },
  {
    "stepId": "Q2",
    "state": "succeeded"
  },
  {
    "stepId": "Q3",
    "state": "running"
  },
  {
    "stepId": "Q3",
    "state": "succeeded"
  },
  {
    "stepId": "Q4",
    "state": "running"
  },
  {
    "stepId": "Q4",
    "state": "succeeded"
  },
  {
    "stepId": "Q5",
    "state": "running"
  },
  {
    "stepId": "Q5",
    "state": "succeeded"
  },
  {
    "stepId": "A5",
    "state": "running"
  },
  {
    "stepId": "A5",
    "state": "succeeded"
  },
  {
    "stepId": "Q6",
    "state": "running"
  },
  {
    "stepId": "Q6",
    "state": "succeeded"
  },
  {
    "stepId": "A6",
    "state": "running"
  },
  {
    "stepId": "A6",
    "state": "succeeded"
  },
  {
    "stepId": "Q7",
    "state": "running"
  },
  {
    "stepId": "Q7",
    "state": "succeeded"
  },
  {
    "stepId": "A7",
    "state": "running"
  },
  {
    "stepId": "A7",
    "state": "succeeded"
  }
]
```

