import dataclasses

from pydantic import BaseModel

class Defaults:
    state = 0
    step_index = 1
    easy_multiplier = 2
    repetitions = 3
    failures_while_review = 4

defaults = Defaults()

class Progress(BaseModel):
    state: int = 1
    step_index: int | None = 1
    easy_multiplier: None = None
    repetitions: None = None
    failures_while_review: None = None

    def is_complete(self) -> bool:
        return bool(self.state) and bool(self.step_index)

progress_orm = Progress(
    state = 1,
    step_index = None,
    easy_multiplier = None,
    repetitions = None,
    failures_while_review = None
)

fields = {
    "state": progress_orm.state,
    "step_index": progress_orm.step_index,
    "easy_multiplier": progress_orm.easy_multiplier,
    "repetitions": progress_orm.repetitions,
    "failures_while_review": progress_orm.failures_while_review
}

# for attribute in progress_orm.model_fields_set:
#     print(getattr(progress_orm, attribute))


for attribute, value in fields.items():
    if value == None:
        fields[attribute] = getattr(defaults, attribute)

# class Rate:
#     a = 1
#     b = 10
#
#     def check(self):
#         return self.a or self.b

# print(progress_orm.is_complete())

card_dict = {
    "id": 1,
    "deckId": 2,
    "front": 3,
    "back": 4,
    "codeExample": 5,
    "difficulty": 6,
    "tags": 7,
}

new_cards = []
new_cards.append({**card_dict, "queue": "new"})

ll = ["a", "b", "c"]
first = ll[0]


class MyClass:
    pass

a = MyClass()
b = MyClass()


import json

@dataclasses.dataclass
class DeckORM:
    id:int
    title: str
    description: str
    track: str
    card_count: int

with open("db/learning_content/cards.json", "r") as handle:
    cards = json.load(handle)

for theme in cards.items():
    for card in theme:
        print(card[0])

K8S_DECK_BY_TAG_GROUP = {
      "k8s_networking": {
          "services",
          "networking",
          "ingress",
          "networkpolicy",
          "dns",
          "cni",
          "headless",
          "endpoints",
          "kube-proxy",
      },
      "k8s_storage": {
          "configmaps",
          "secrets",
          "pv",
          "pvc",
          "storageclasses",
          "rbac",
          "serviceaccounts",
          "security",
          "pss",
          "admission"
      },
      "k8s_ops": {
          "hpa",
          "vpa",
          "scheduling",
          "debugging",
          "crds",
          "operators",
          "helm",
          "etcd",
          "apiserver",
          "scheduler",
          "controller",
          "kubelet",
          "preemption",
          "autoscaler",
          "garbage"
      },
}
def mappp(match):
    for theme in K8S_DECK_BY_TAG_GROUP:
        if match in K8S_DECK_BY_TAG_GROUP[theme]:
            print(theme)
