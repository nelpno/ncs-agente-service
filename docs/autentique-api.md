# Autentique API — referência (baixada 2026-06-28 de https://docs.autentique.com.br/api)

> Fonte oficial: https://docs.autentique.com.br/api (GitBook). GraphQL endpoint: https://api.autentique.com.br/v2/graphql

---

## ⚡ Cheat-sheet (integração NCS — CND oficial)

- **Endpoint:** `POST https://api.autentique.com.br/v2/graphql`
- **Auth:** header `Authorization: Bearer <AUTENTIQUE_TOKEN>` (gerar no painel → Integrações → Acessos a API → "Gerar novo token de API"). O token serve p/ sandbox E produção.
- **Sandbox:** adicionar `sandbox: true` no `createDocument(...)`. **Não gasta crédito**, não dispara assinatura real, doc some em poucos dias. Controlado por env `AUTENTIQUE_SANDBOX` (começamos em `true`). Pra ver no painel, ligar "Mostrar documentos criados em Sandbox/Testes".
- **Upload = multipart/form-data** (spec graphql-multipart-request): 3 campos →
  - `operations` = JSON `{"query":"...","variables":{"document":{"name":"..."},"signers":[...],"file":null}}`
  - `map` = `{"file":["variables.file"]}`
  - `file` = o binário do PDF
- **Mutation:**
  ```graphql
  mutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
    createDocument(sandbox: true, document: $document, signers: $signers, file: $file) {
      id name created_at
      signatures { public_id name email created_at action { name } link { short_link } }
    }
  }
  ```
- **Signer (síndico):** e-mail → `{ "email": "sindico@...", "action": "SIGN" }`. WhatsApp → `{ "phone":"+5516...", "delivery_method":"DELIVERY_METHOD_WHATSAPP", "action":"SIGN" }` (SMS = `DELIVERY_METHOD_SMS`).
- **Link p/ mandar (o `assina.ae`):** `data.createDocument.signatures[].link.short_link`.
- **Preços:** criar doc US$0,01 · assinatura por e-mail US$0,002 · por WhatsApp US$0,02 · sandbox grátis.
- **Módulo NCS:** `src/autentique.mjs` (env-gated por `AUTENTIQUE_TOKEN`; inerte+avisa se não configurado). Pendência p/ go-live do CND oficial: **e-mail/WhatsApp do síndico por condomínio** (não temos hoje — só o nome no catálogo).

---



<!-- ============ Introdução / Quick Start (/master.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/master.md).

# Introduction

### Quick Start

If you're already familiar with GraphQL APIs, the process is pretty simple:

* Generate keys to use the API in the Autentique dashboard, in [API keys](https://painel.autentique.com.br/perfil/api).
* Use the following endpoint and headers:

```http
POST https://api.autentique.com.br/v2/graphql HTTP/1.1
Authorization: Bearer YOUR_API_KEY_HERE
```

* See everything you can do with the API scheme (You can use Altair, we’ve created pre-set collections for you to try out :wink:)

<figure><img src="/files/t1MZhUeIrkP7mnjU0mQ4" alt=""><figcaption></figcaption></figure>

* Develop the integration with [Autentique](https://autentique.com.br/). (If you don't want to waste documents while testing, read how to use the Sandbox below)

{% content-ref url="/pages/-LzIssX3LbbfpZ7OlpOM" %}
[Sandbox/tests](/api/integration-basics/sandbox-testes.md)
{% endcontent-ref %}

* The API has a rate limit of 60 requests per minute. For specific error messages, check the Error Messages section.
* Appreciate a job well done.

{% hint style="info" %}
If Altair doesn’t help you integrate with the API, check out some examples of how to make these requests in other ways: <https://graphql.org/graphql-js/graphql-clients/>
{% endhint %}

{% hint style="info" %}
We also have an integration with the Make platform. Our collection includes modules for the most commonly used requests. If you have any questions, contact our support. You can access the Make platform at: <https://www.make.com/en>
{% endhint %}

{% file src="/files/-M03o9cE5QB3vLoPUlzJ" %}
Para importar e usar no Postman
{% endfile %}

{% hint style="info" %}
Some users have created SDKs for Autentique that can help you with the implementation. Don’t forget to give them a shout-out!

1. **NodeJS**: <https://github.com/thiagozampieri/autentique-v2-nodejs> ( by Thiago Zampieri)
2. **NodeJS**: <https://www.npmjs.com/package/autentique-v2-nodejs/v/1.0.9> (by the guys from vixting.com.br)
3. **PHP**:  <https://github.com/vinicinbgs/autentique-v2> (by Vinicius)
4. **PHP**: <https://github.com/sysborg/autentiquev2> (by Anderson Matheus Arruda)
5. **Delphi:** <https://github.com/rt-martins/autentique-v2-delphi> (by Rodrigo Martins)
6. **.NET:** <https://github.com/datasuricata/autentique.signature> (by Lucas Moraes)
   {% endhint %}

{% hint style="info" %}
If you find any issue with the documentation or the API, don’t hesitate to let us know at <contato@autentique.com.br>
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/master.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Sobre GraphQL (/sobre-o-graphql.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/sobre-o-graphql.md).

# About GraphQL

### What is GraphQL?

When you think of Facebook, you probably imagine cat pictures and distant relatives—but they also create useful technologies like GraphQL.

In the words of the official [GraphQL website](https://graphql.org/):

> GraphQL is a query language for APIs and a runtime for executing those queries with your existing dat&#x61;**.** GraphQL provides a complete and understandable description of the data in your API, gives clients the power to ask for exactly what they need and nothing more, makes it easier to evolve APIs over time, and enables powerful developer tools.

In other words, it’s an alternative to REST for making API requests. You can choose which information to return and run multiple independent queries in a single request. It’s also very convenient for us on the API side, since we don’t need to constantly change endpoints to support new features.

### Why are we using GraphQL?

GraphQL helps us build more dynamic applications and serve our API clients more efficiently—without making changes that affect everyone.

You know that moment when your backend is so full of hacks and last-minute features that it becomes a spaghetti mess no one understands anymore? Like those COBOL-based systems that charge a fortune for small changes because no one knows what might break? That’s reason number one. (And also a good reason to rebuild things from time to time.)

GraphQL makes our lives easier by reducing the number of MVC controllers. And it brings several advantages for you too:

* Fewer requests to the API by chaining independent queries into a single request
* Strong typing helps avoid bugs from unexpected data formats
* Smaller and faster responses since you only ask for what you need

We're enjoying working with GraphQL, and we hope you’ll enjoy playing with queries and using the code generators that come with having a full API schema.

{% hint style="info" %}
You can better understand everything you can do with GraphQL at [graphql.org](https://graphql.org)\
Or check out this awesome list of GraphQL resources: [github.com/chentsulin/awesome-graphql](https://github.com/chentsulin/awesome-graphql)
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/sobre-o-graphql.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ API Pricing (/api-pricing.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/api-pricing.md).

# API pricing

API usage follows the same plans as regular usage through the web application. However, the plan’s cost serves as a monthly usage commitment, and additional charges apply if total API usage exceeds that amount. The free plan has no fees but is limited to 20 documents per month.

You can check your current API usage on [Plans and Payment section of your account.](https://painel.autentique.com.br/perfil/planos#api)

### Prices per document and signature request

<table><thead><tr><th width="505.7890625">Action</th><th width="113.4453125">USD</th><th>BRL</th></tr></thead><tbody><tr><td>Document creation</td><td>$ 0.01</td><td>R$ 0,06</td></tr><tr><td>Signature request via Email</td><td>$ 0.002</td><td>R$ 0,013</td></tr><tr><td>Signature request via Whatsapp</td><td>$ 0.02</td><td>R$ 0,12</td></tr><tr><td>Signature request via SMS</td><td>$ 0.03</td><td>R$ 0,16</td></tr><tr><td>Signature request via link, signed through email</td><td>$ 0.002</td><td>R$ 0,013</td></tr><tr><td>Signature request via link, signed through SMS</td><td>$ 0.03</td><td>R$ 0,16</td></tr><tr><td>Signature request via link, signed through Whatsapp</td><td>$ 0.02</td><td>R$ 0,12</td></tr><tr><td>Signature with additional Phone validation</td><td>$ 0.03</td><td>R$ 0,16</td></tr></tbody></table>

Prices are cumulative and depend on the number of signers and the signature methods used.

{% hint style="info" %}
**Example:** A document created with 2 signers (one via email and one via WhatsApp):

* Create document: $ 0.01
* Signer 1: Signature request via email: $ 0.002
* Signer 2: Signature request via WhatsApp: $ 0.02

Total document API charge: **$ 0.193**
{% endhint %}

Signers added via a signing link can select their preferred signing method: email, SMS, WhatsApp, or authentication via Google, Microsoft, or Facebook. They are charged according to the method they choose to sign the document, but signatures completed via Google, Microsoft, or Facebook login are free of charge.

{% hint style="info" %}
**Example:** A document created with 2 signers (both via signing link):

* Create document: $ 0.01
* Signer 1: Signs using Google login (Free)
* Signer 2: Signs via WhatsApp link ($ 0.02)

**Total document** API charg&#x65;**: $ 0.03**
{% endhint %}

The cost of signing via a WhatsApp link may differ from the cost of sending a signature request through WhatsApp due to WhatsApp API message category pricing. However, this is not usually the case. Keep this in mind when designing your signing flow to optimize message delivery costs.

{% hint style="success" %}
If you have a specific use case that’s not feasible under this pricing model, feel free to reach out to our sales team. Custom, volume-based pricing can be negotiated under the Corporate plan.
{% endhint %}

{% hint style="warning" %}
There will be no charge for [resending subscriptions](https://docs.autentique.com.br/api/mutations/resend-signatures)!
{% endhint %}

### Pricing per query

Some queries incur a cost when executed. This charge is primarily intended to discourage implementations that make excessive data requests (we’ve all been there). Still, those workarounds started adding up on our end, so please don’t use Autentique as your backend.

<table><thead><tr><th width="502.06640625">Query</th><th width="114.92578125">USD</th><th>BRL</th></tr></thead><tbody><tr><td>Retrieve document data (per document)</td><td>$ 0,0002</td><td>R$ 0,001</td></tr><tr><td>Webhook Delivery</td><td>$ 0,00004</td><td>R$ 0,0002</td></tr></tbody></table>

“Retrieve document data” charges are applied per document retrieved, not per query. So if you request 10 documents in a single query, you’ll be charged $ 0.0002 × 10.

{% hint style="warning" %}
You typically don’t need to worry about query costs unless you’re doing something very wrong. If you ever notice a significant charge from queries, it might be a good time to sit in the shower, stare at the tiles, and reconsider your architecture choices.
{% endhint %}

### Webhook pricing

To keep your application updated efficiently, you can set up webhook endpoints to receive real-time updates. This is the clean, no-hacks way to keep your systems in sync with the latest document information. Check out our documentation for details, and contact support if you have any questions.

{% hint style="info" %}
All webhook deliveries incur processing costs and are therefore included in billing.
{% endhint %}

Failed webhook deliveries appear in your dashboard, where you can review and retry them. Failed deliveries are included in billing, but retries are not.

{% hint style="warning" %}
[Deprecated webhook](/api/integration-basics/webhooks-1.md) events are also counted but do not appear in the failed webhooks list.
{% endhint %}

### Request limit

Each plan includes a default rate limit (requests per minute) per API token. If you need a higher limit, just reach out and we’ll adjust it based on your needs.

<table><thead><tr><th width="157">Plan</th><th>Standart limit</th></tr></thead><tbody><tr><td>Free</td><td>10 per minute</td></tr><tr><td>Professional</td><td>60 per minute</td></tr><tr><td>Corporate</td><td>200 per minute</td></tr></tbody></table>

### Usage commitment and billing

The plan’s cost represents a minimum monthly usage commitment. If your API usage exceeds that amount, the excess will be billed on an additional invoice covering the previous month’s activity.

{% hint style="info" %}
**Example:** An organization on the Professional plan ($ 19.00/month) creates 1,000 documents via API with two email signers each:

* Document creation: $ 0.01 × 1,000 = $ 10.00
* Two email signers per document: $ 0,002 × 1,000 × 2 = $ 4.00

**Total usage:** $ 14.00 (below the plan's value)

**Final charge:** Plan cost only **($ 19.00).**
{% endhint %}

{% hint style="info" %}
**Example:** An organization on the Professional plan ($ 19.00/month) creates 1,000 documents via API with two WhatsApp signers each:

* Document creation: $ 0.01 × 1,000 = $ 10.00
* Two WhatsApp signers per document: $ 0.02 × 1,000 × 2 = $ 40.00

**Total usage:** $ 50.00 (above the plan amount)

**Final charge:** $ 19.00 (plan) + $ 31.00 (overage amount) = **$ 50.00**
{% endhint %}

***

**Important:** Actions performed through the web application don’t generate charges and don’t affect API billing.

{% hint style="info" %}
You create 1,000 documents via API with two email signers ($ 14.00).

You also create 2,000 documents through the web app.

Total charge: Plan cost only ($ 19.00).
{% endhint %}

### Sandbox and tests

Documents created with the parameter `sandbox: true` are not charged. However, they are meant strictly for testing and are automatically deleted after a few days.

{% hint style="danger" %}
**Do not use real documents in sandbox.** The sandbox is for testing purposes only. Sandbox documents are automatically deleted, they do not generate audit logs, and cannot be used for verifying signatures or authenticating documents.
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/api-pricing.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Sandbox / testes (/integration-basics/sandbox-testes.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/integration-basics/sandbox-testes.md).

# Sandbox/tests

For context, we recommend reading how document creation and listing work first:

{% content-ref url="/pages/-LsYgNLWMNqAlDnd53uc" %}
[Creating a document](/api/mutations/criando-um-documento.md)
{% endcontent-ref %}

{% content-ref url="/pages/-LsYgEpXilJyyGsfTnN1" %}
[Retrieving documents](/api/queries/resgatando-documentos.md)
{% endcontent-ref %}

### Creating Sandbox documents

Creating test documents only depends on a single attribute to be set in the document: `"sandbox"`.

```javascript
mutation CreateDocumentMutation(
  ...
) {
  createDocument(
    sandbox: true,
    document: $document,
    signers: $signers,
    file: $file
  ) {
  ...
  }
}
```

Done! Documents created with `"sandbox"` won’t consume credits, but since they are test documents, they will be deleted after a few days.

Until they are deleted, you can view them in the document listings on the dashboard if you enable the following option on the API keys page:

<figure><img src="/files/t7DNrLfFBXl8PSe06TMY" alt=""><figcaption></figcaption></figure>

### Retrieving Sandbox Documents

Just like in the dashboard, the document listing does **not** return sandbox documents by default.

To include them, you need to enable two specific flags.

**Enabling sandbox document listing**

To allow the listing to return documents created in sandbox mode, add the `showSandbox` flag in the query parameters:

```graphql
query {
  documents(
    limit: 60, 
    page: 1,
    showSandbox: true
  ) {
  ...
  }
}
```

**Listing only sandbox documents**

You can also retrieve **only** the documents created in sandbox mode. To do that, add the `onlySandbox` flag in the query parameters:

```graphql
query {
  documents(
    limit: 60, 
    page: 1,
    onlySandbox: true
  ) {
  ...
  }
}
```

{% hint style="info" %}
You can check what each of these parameters means directly in the full GraphQL API documentation, under the **Docs** tab in Altair. Not sure how to access it? Check out our tutorial: **Usando o Altair**.
{% endhint %}

{% hint style="warning" %}
If you're unsure how to send a document in your integration, this repository provides more information and examples on how to handle file uploads:

<https://github.com/jaydenseric/graphql-multipart-request-spec>
{% endhint %}

{% file src="/files/-M03o9cE5QB3vLoPUlzJ" %}
Para importar e usar no Postman
{% endfile %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/integration-basics/sandbox-testes.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Webhooks (/integration-basics/webhooks.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/integration-basics/webhooks.md).

# Webhooks

## Why use *Webhooks*?

When building integrations with Autentique, it can be helpful for your applications to receive events as they happen in your organizations.

To start receiving webhooks, you need to register your endpoints in the dashboard. After registration, Autentique can send real-time event data to your webhook endpoints whenever events occur in your organization. Autentique uses HTTPS to send these events as a JSON payload, which includes an Event object.

Receiving webhook events is especially useful for tracking asynchronous events, such as when a signer signs a document, when a document is completed, or when actions related to document processing are finished.

### Event Object

The following event shows an `update` to the name of a document.

{% code overflow="wrap" lineNumbers="true" fullWidth="false" %}

```json
{
  "id": "MXwyMWZiY2VjOS1lMWI1LTRkY2EtYWZiYi0wMjIwNjFlOWVhODg=",
  "object": "webhook",
  "name": "test endpoint 2",
  "format": "json",
  "url": "https://this-url-doesn't-exist.autentique.com.br/webhooks",
  "event": {
    "id": "21fbcec9-e1b5-4dca-afbb-022061e9ea88",
    "object": "event",
    "organization": 1,
    "type": "document.updated",
    "data": {
      "object": {
        "id": "89c7d2ab31f9f5a13b3d20ecf53319af387e54d240ae7be993",
        "name": "Updated name",
        "refusable": true,
        "stop_on_rejected": true,
        "qualified": false,
        "ignore_cpf": true,
        "sortable": false,
        "is_blocked": false,
        "sandbox": 0,
        "scrolling_required": 0,
        "locale": {
          "country": "BR",
          "language": "pt-BR",
          "timezone": "America/Sao_Paulo",
          "date_format": "d/m/Y"
        },
        "created_at": "2024-08-26T18:02:26.000000Z",
        "updated_at": "2024-08-26T18:03:27.000000Z",
        "deleted_at": null,
        "deadline_at": null,
        "lifecycle_in": "2029-08-26T03:00:00.000000Z",
        "email_template_id": null,
        "expiration_at": null,
        "notify_in": null,
        "reminder": null,
        "message": "I changed this message too",
        "reply_to": null,
        "signatures_count": 1,
        "signed_count": 0,
        "rejected_count": 0,
        "object": "document",
        "is_from_api": false,
        "signatures": [
          {
            "public_id": "7f25d72b-6155-11ef-9dae-0242ac170004",
            "name": "Felipe Autentique",
            "company": null,
            "email": "felipe@autentique.com.br",
            "phone": null,
            "cpf": "123.456.789-09",
            "birthday": "1979-08-13",
            "action": "Sign",
            "viewed": "2024-08-26T18:02:27.000000Z",
            "signed": null,
            "rejected": null,
            "validation_unapproved": null,
            "validation_approved": null,
            "validation_rejected": null,
            "created_at": "2024-08-26T18:02:26.000000Z"
          }
        ],
        "author": {
          "name": "Felipe Autentique",
          "company": null,
          "email": "felipe@autentique.com.br",
          "phone": null,
          "cpf": "123.456.789-09",
          "birthday": "1979-08-13"
        },
        "files": {
          "original": "https://storage.googleapis.com/f77/6e7a1fadeed9c56cf037b43a9cd0e6d1/o9baEgHHv1Tuf7AZttDqdL8vK68eUw56PaYXzRqV.original.pdf",
          "signed": "https://painel.autentique.com.br/documentos/89c7d2ab31f95a13b3d20ecf53319af387e54d240ae7be993/assinado.pdf",
          "certified": "https://painel.autentique.com.br/documentos/89c7d2ab31f95a13b3d20ecf53319af387e54d240ae7be993/certificado.pdf",
          "pades": "https://painel.autentique.com.br/documentos/89c7d2ab31f95a13b3d20ecf53319af387e54d240ae7be993/pades.pdf"
        }
      },
      "previous_attributes": {
        "name": "teste",
        "refusable": false,
        "updated_at": "2024-08-26T18:02:26.000000Z",
        "message": "Please access and electronically sign the document by clicking the button above.",
        "ignore_cpf": false
      }
    },
    "created_at": "2024-08-26T18:03:27.387179Z"
  }
}
```

{% endcode %}

#### Type of Event

All webhooks sent are related to an event of a specific resource, which is indicated by the `type` field. Similarly, the `data.object` field corresponds to the resource of the event.

#### **Data Object and previous\_attributes**

For `*.updated` events, the event payload includes the `data.previous_attributes` field, which allows you to inspect what changed in the related resource. In the example above, the `document.updated` event shows that the document previously had the name "teste".

## How to Begin

1. Add your endpoint in the Autentique Developer Panel, selecting the events you want to listen to.
2. Set up an HTTPS function that accepts webhook requests with a POST method.
   1. Process POST requests with a JSON payload consisting of an event object.
   2. Quickly return a success status code (2xx) before any complex logic that may cause a timeout. For example, you need to return a 200 response before updating document data in your system.
   3. If desired, you can verify that events are sent by Autentique before performing any manipulation with the payload.

#### Examples of endpoint:

{% tabs %}
{% tab title="PHP" %}

```php
$payload = @file_get_contents('php://input');
$webhook = null;

//Before processing the payload

try {
    $webhook = json_decode($payload, true);
} catch(\UnexpectedValueException $e) {
    // Invalid payload
    http_response_code(400);
    exit();
}

$event = $webhook['event'];

// Process the event
switch ($event['type']) {
    case 'document.created':
        $document = $event['data']['object']; // Contains a document object,
        // define a method to process the document
        // handleDocumentCreated($document);
        break;
    case 'signature.accepted':
        $signature = $event['data']['object']; // Contains a signature object
        // Define a method to process the signature
        // handleSignatureAccepted($signature);
        break;
        // ... process other types of events
    default:
        echo 'Received unknown event type '.$event['type'];
}

http_response_code(200);
```

{% endtab %}

{% tab title="Go" %}

```go
package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
)

type WebhookPayload struct {
	ID     string `json:"id"`
	Object string `json:"object"`
	Name   string `json:"name"`
	Format string `json:"format"`
	URL    string `json:"url"`
	Event  Event  `json:"event"`
}

type Event struct {
	ID           string                 `json:"id"`
	Object       string                 `json:"object"`
	Organization int                    `json:"organization"`
	Type         string                 `json:"type"`
	Data         map[string]interface{} `json:"data"`
	CreatedAt    string                 `json:"created_at"`
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	payload, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	var webhook WebhookPayload
	if err := json.Unmarshal(payload, &webhook); err != nil {
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	event := webhook.Event
	eventData := event.Data
	eventObject := eventData["object"].(map[string]interface{})

	switch event.Type {
	case "document.created":
		// handleDocumentCreated(eventObject)
		fmt.Println("Document created:", eventObject)
	case "document.updated":
		// handleDocumentUpdated(eventObject)
		fmt.Println("Document updated:", eventObject)
	case "signature.accepted":
		// handleSignatureAccepted(eventObject)
		fmt.Println("Signature accepted:", eventObject)
	default:
		fmt.Printf("Received unknown event type: %s\n", event.Type)
	}

	w.WriteHeader(http.StatusOK)
}

func main() {
	http.HandleFunc("/webhook", webhookHandler)
	http.ListenAndServe(":8080", nil)
}
```

{% endtab %}

{% tab title="Java" %}

```java
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;

import java.util.Map;

@RestController
@RequestMapping("/webhook")
public class WebhookController {

    @PostMapping
    public ResponseEntity<String> handleWebhook(@RequestBody Map<String, Object> payload) {
        try {
            Map<String, Object> event = (Map<String, Object>) payload.get("event");
            String eventType = (String) event.get("type");
            Map<String, Object> data = (Map<String, Object>) event.get("data");
            Map<String, Object> eventObject = (Map<String, Object>) data.get("object");

            switch (eventType) {
                case "document.created":
                    // handleDocumentCreated(eventObject);
                    System.out.println("Document created: " + eventObject);
                    break;
                case "document.updated":
                    // handleDocumentUpdated(eventObject);
                    System.out.println("Document updated: " + eventObject);
                    break;
                case "signature.accepted":
                    // handleSignatureAccepted(eventObject);
                    System.out.println("Signature accepted: " + eventObject);
                    break;
                default:
                    System.out.println("Received unknown event type: " + eventType);
            }

            return new ResponseEntity<>("Webhook received", HttpStatus.OK);
        } catch (Exception e) {
            return new ResponseEntity<>("Invalid payload", HttpStatus.BAD_REQUEST);
        }
    }
}
```

{% endtab %}

{% tab title="NodeJS" %}

```javascript
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

app.post('/webhook', (req, res) => {
    try {
        const payload = req.body;
        const event = payload.event;
        const eventType = event.type;
        const eventData = event.data;
        const eventObject = eventData.object;

        switch (eventType) {
            case 'document.created':
                // handleDocumentCreated(eventObject);
                console.log("Document created:", eventObject);
                break;
            case 'document.updated':
                // handleDocumentUpdated(eventObject);
                console.log("Document updated:", eventObject);
                break;
            case 'signature.accepted':
                // handleSignatureAccepted(eventObject);
                console.log("Signature accepted:", eventObject);
                break;
            default:
                console.log(`Received unknown event type: ${eventType}`);
        }

        res.status(200).send('Webhook received');
    } catch (error) {
        res.status(400).send('Invalid payload');
    }
});

app.listen(8080, () => {
    console.log('Server is running on port 8080');
});
```

{% endtab %}

{% tab title="Python" %}

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhook', methods=['POST'])
def webhook():
    try:
        payload = request.json
        event = payload['event']
        event_type = event['type']
        event_data = event['data']
        event_object = event_data['object']

        if event_type == 'document.created':
            # handle_document_created(event_object)
            print("Document created:", event_object)
        elif event_type == 'document.updated':
            # handle_document_updated(event_object)
            print("Document updated:", event_object)
        elif event_type == 'signature.accepted':
            # handle_signature_accepted(event_object)
            print("Signature accepted:", event_object)
        else:
            print(f"Received unknown event type: {event_type}")

        return jsonify({"status": "success"}), 200
    except Exception as e:
        return jsonify({"error": "Invalid payload"}), 400

if __name__ == '__main__':
    app.run(port=8080)
```

{% endtab %}

{% tab title="Ruby" %}

```ruby
class WebhooksController < ApplicationController
    skip_before_action :verify_authenticity_token

    def webhook
        begin
            payload = JSON.parse(request.body.read)
            event = payload['event']
            event_type = event['type']
            event_data = event['data']
            event_object = event_data['object']

            case event_type
            when 'document.created'
                # handle_document_created(event_object)
                puts "Document created: #{event_object}"
            when 'document.updated'
                # handle_document_updated(event_object)
                puts "Document updated: #{event_object}"
            when 'signature.accepted'
                # handle_signature_accepted(event_object)
                puts "Signature accepted: #{event_object}"
            else
                puts "Received unknown event type: #{event_type}"
            end

            render json: { status: 'success' }, status: :ok
        rescue => e
            render json: { error: 'Invalid payload' }, status: :bad_request
        end
    end
end
```

{% endtab %}
{% endtabs %}

### Event Order: <a href="#event-ordering" id="event-ordering"></a>

Autentique does not guarantee the delivery of events in the order they were generated. For example, the creation of a document may generate the following events:

* `document.updated`
* `document.created`
* `signature.created`
* `signature.viewed` (if the author is a signer and in the document creation)&#x20;

Your endpoint should not expect the delivery of these events in this order and should process them accordingly. You can also use the API to retrieve missing objects (for example, you can get signatures, folders, and organizations using the information from `document.created` if you receive that event first).

### Best practices for Webhook usage

Review these best practices to ensure that your webhooks remain secure and work well with your integration.

**Quickly Return a 2xx Response**

The endpoint must quickly return a success status code (2xx) before any complex logic that could cause a timeout. For example, when receiving a `document.finished` event, you need to return a 200 response before updating the document data in your system.

**Manage Events Asynchronously**

Set up the handler to process received events with an asynchronous queue. Synchronously processing events can cause scalability issues, especially during peak webhook delivery times.

* **Using Queues**: Use asynchronous queues to process events concurrently at a rate your system can handle.

**Handle Duplicate Events**

Occasionally, webhook endpoints may receive the same event more than once. To protect against receiving duplicate events:

* **Store Event IDs**: Keep track of the event IDs you have processed and ignore already registered events.
* **Duplicate Identification**: In some cases, two webhooks of the same event may be sent to your endpoint. Use the object ID in `event.data` along with the `event.type`.

**Listen Only to Required Event Types**

Configure your webhook endpoints to receive only the event types required by your integration. Listening for additional or all events can overload your server and is not recommended.

* **Event Configuration**: You can change the events that a webhook endpoint receives in the Dashboard.

**CSRF Protection-Free Webhook Route**

If you're using frameworks like Rails, Django, or Laravel, your site may automatically check if each POST request contains a CSRF token. This is an important security feature that protects against cross-site request forgery attacks but may prevent your site from processing legitimate webhook events. To resolve this, you can exempt the webhook route from CSRF protection.

{% tabs %}
{% tab title="Laravel" %}

```php
<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Middleware;

# On Laravel, 
# you can add the webhook route as an exception
# middleware VerifyCsrfToken on the file `bootstrap/app.php`
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->validateCsrfTokens(except: [
            'webhooks/*' // <-- remove the validation route
        ]);
    })->create();
```

{% endtab %}

{% tab title="Django" %}

```python
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse

# No Django, você pode isentar uma view específica 
# da verificação CSRF sando o decorator @csrf_exempt
@csrf_exempt
@require_POST
def webhook_endpoint(request):
    # Processar o webhook
```

{% endtab %}

{% tab title="Rails" %}

```ruby
# No Rails, você pode isentar uma ação específica do protect_from_forgery
class WebhooksController < ApplicationController
  protect_from_forgery except: :webhook

  def webhook
    # Process webhook data in `params`
  end

end
```

{% endtab %}
{% endtabs %}

**Verify if Events Are Sent by Autentique**

To ensure that the events you receive truly come from Autentique, it's crucial to validate the HMAC signatures present in the webhook headers. Here are some examples of how to do this:

{% tabs %}
{% tab title="PHP" %}

```php
public function verifySignature(array $headers, string $payload, string $secret): bool
{
    if (!isset($headers['x-autentique-signature'])) {
        return false;
    }

    $signature = $headers['x-autentique-signature'];
    $calculatedSignature = hash_hmac('sha256', $payload, $secret);

    return hash_equals($calculatedSignature, $signature);
}
```

{% endtab %}

{% tab title="Node" %}

```javascript
const crypto = require('crypto');

function verifySignature(headers, rawBody, secret) {
  const signature = headers["x-autentique-signature"];
  if (!signature) {
    return false;
  }
  const calculatedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(calculatedSignature, "hex"),
    Buffer.from(signature, "hex"),
  );
}
```

{% endtab %}

{% tab title="Python" %}

```python
import hmac
import hashlib
import json

def verify_signature(headers, payload, secret):
    signature = headers.get('X-Autentique-Signature')
    if not signature:
        return False
    payload_json = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    calculated_signature = hmac.new(secret.encode('utf-8'), payload_json, hashlib.sha256).hexdigest()
    return hmac.compare_digest(calculated_signature, signature)
```

{% endtab %}

{% tab title="Ruby" %}

```ruby
require 'json'
require 'openssl'
require 'active_support/security_utils'

def verify_signature(headers, payload, secret)
  signature = headers['X-Autentique-Signature']
  return false unless signature
  payload_json = payload.to_json
  calculated_signature = OpenSSL::HMAC.hexdigest('SHA256', secret, payload_json)
  ActiveSupport::SecurityUtils.secure_compare(calculated_signature, signature)
end
```

{% endtab %}

{% tab title="Java" %}

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

public class WebhookVerifier {
    private String secret;

    public WebhookVerifier(String secret) {
        this.secret = secret;
    }

    public boolean verifySignature(String headerSignature, String payload) throws Exception {
        String calculatedSignature = calculateSignature(payload);
        return MessageDigest.isEqual(calculatedSignature.getBytes(StandardCharsets.UTF_8),
                                     headerSignature.getBytes(StandardCharsets.UTF_8));
    }

    private String calculateSignature(String payload) throws Exception {
        Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
        SecretKeySpec secret_key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        sha256_HMAC.init(secret_key);
        byte[] hash = sha256_HMAC.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        return bytesToHex(hash);
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder(2 * bytes.length);
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if(hex.length() == 1) hexString.append('0');
            hexString.append(hex);
        }
        return hexString.toString();
    }
}

```

{% endtab %}
{% endtabs %}

### Document Object

```json
{
  "id": "MXwwNmMzOGYyMS0zNjhjLTQyNmItOTM2Ny1iMzNhNzQ2NmY5MGM=",
  "object": "webhook",
  "name": "docs",
  "format": "json",
  "url": "https://this-url-does't-exist.autentique.com.br/webhooks",
  "event": {
    "id": "06c38f21-368c-426b-9367-b33a7466f90c",
    "object": "event",
    "organization": 1,
    "type": "document.updated",
    "data": {
      "id": "1cf7d351a96696fdf450ba893f6720463599dd8c34e0aeda803d",
      "object": "document",
      "name": "test sddd",
      "message": "Please access and electronically sign the document by clicking the button above.",
      "refusable": true,
      "author": {
        "name": "Felipe Autentique",
        "company": null,
        "email": "felipe@autentique.com.br",
        "phone": null,
        "cpf": "03351152094",
        "birthday": "2005-01-24"
      },
      "signatures": [
        {
          "public_id": "92b49dbe-df08-11ef-903c-0242ac140004",
          "object": "signature",
          "user": {
            "name": "Felipe Autentique",
            "company": null,
            "email": "felipe@autentique.com.br",
            "phone": null,
            "cpf": "03351152094",
            "birthday": "2005-01-24"
          },
          "document": "1cf7d351a96696450ba893f6720463599dd8c34e0aeda803d",
          "action": "Sign",
          "viewed": "2025-01-30T12:49:01.000000Z",
          "signed": null,
          "rejected": null,
          "biometric_unapproved": null,
          "biometric_approved": null,
          "biometric_rejected": null,
          "events": [],
          "created_at": "2025-01-30T12:48:58.000000Z"
        },
        {
          "public_id": "93115640-df08-11ef-903c-0242ac140004",
          "object": "signature",
          "user": {
            "name": "Mateus Autentique",
            "company": null,
            "email": "mateus@autentique.com.br",
            "phone": null,
            "cpf": "189.614.966-03",
            "birthday": "1979-04-19"
          },
          "document": "1cf7d351a96696450ba893f6720463599dd8c34e0aeda803d",
          "action": "Sign",
          "viewed": null,
          "signed": null,
          "rejected": null,
          "biometric_unapproved": null,
          "biometric_approved": null,
          "biometric_rejected": null,
          "events": [],
          "created_at": "2025-01-30T12:48:59.000000Z"
        }
      ],
      "stop_on_rejected": true,
      "qualified": false,
      "ignore_cpf": false,
      "sortable": false,
      "is_blocked": false,
      "sandbox": false,
      "api": false,
      "scrolling_required": false,
      "locale": {
        "country": "BR",
        "language": "pt-BR",
        "timezone": "America/Sao_Paulo",
        "date_format": "d/m/Y"
      },
      "email_template_id": null,
      "expiration_at": null,
      "notify_in": null,
      "reminder": null,
      "reply_to": null,
      "signatures_count": 2,
      "signed_count": 0,
      "rejected_count": 0,
      "files": {
        "original": "https://storage.googleapis.com/f77-dev/9be6ab49679f844230682d7335230029/3jTmKFWps4mIaMByzrj7zmFywm4a6LYIjUDfNhZ7.original.pdf",
        "signed": "https://painel.autentique.com.br/documentos/1cf7d351a96696450ba893f6720463599dd8c34e0aeda803d/assinado.pdf",
        "certified": "https://painel.autentique.com.br/documentos/1cf7d351a96696450ba893f6720463599dd8c34e0aeda803d/certifcado.pdf",
        "pades": "https://painel.autentique.com.br/documentos/1cf7d351a96696450ba893f6720463599dd8c34e0aeda803d/pades.pdf"
      },
      "created_at": "2025-01-30T12:48:58.000000Z",
      "updated_at": "2025-01-30T12:49:56.000000Z",
      "deleted_at": null,
      "deadline_at": null,
      "lifecycle_in": "2030-01-30T03:00:00.000000Z"
    },
    "previous_attributes": {
      "signatures_count": 3
    },
    "created_at": "2025-01-30T12:49:56.342822Z"
  }
}
```

### Signature Object

```json
{
  "id": "MjV8OTQ4OGNlMTEtNzBiZi00ZGI3LTg1OGItZDc2ZjFkZDI5MGRj",
  "object": "webhook",
  "name": "sig",
  "format": "json",
  "url": "https://this-url-does't-exist.autentique.com.br/webhooks",
  "event": {
    "id": "9488ce11-70bf-4db7-858b-d76f1dd290dc",
    "object": "event",
    "organization": 1519203,
    "type": "signature.accepted",
    "data": {
      "public_id": "f8911dcd-dfcd-11ef-9465-42010a2b610e",
      "object": "signature",
      "user": {
        "name": "Felipe Autentique",
        "company": null,
        "email": "felipe@autentique.com",
        "phone": null,
        "cpf": "03351152094",
        "birthday": "2002-03-04"
      },
      "mail": {
        "sent": "2025-04-09 09:21:35",
        "opened": "2025-04-09 09:25:35",
        "refused": null,
        "delivered": null,
        "reason": null
      },
      "document": "f48a8b465d02dd87559e08f06c41e3b6d548c4d7ad835eb0f",
      "action": "Sign",
      "viewed": "2025-01-31T12:22:01.000000Z",
      "signed": "2025-01-31T12:22:30.000000Z",
      "rejected": null,
      "biometric_unapproved": null,
      "biometric_approved": null,
      "biometric_rejected": null,
      "events": [
        {
          "type": "viewed", // Can be: viewed, accepted, rejected, biometric_approved, biometric_rejected, biometric_unapproved
          "document": "f48a8b465d02dd87559e08f06c41e3b6d548c4d7ad835eb0f",
          "user": {
            "uuid": "ebcca9bc391a60336e777a23d32ada4410fe8b",
            "name": null,
            "email": "felipe@autentique.com",
            "cpf": null,
            "birthday": null
          },
          "geolocation": {
            "country": "Brazil",
            "countryISO": "BR",
            "state": "Rio Grande do Sul",
            "stateISO": "RS",
            "city": "Erechim",
            "zipcode": "99704094",
            "latitude": -27.6767,
            "longitude": -52.2559
          },
          "reason": null,
          "ip": "192.168.65.1",
          "port": 29317,
          "created_at": "2025-03-18T16:22:49.000000Z"
        },
        ...
      ]
      "created_at": "2025-01-31T12:22:00.000000Z"
    },
    "previous_attributes": [],
    "created_at": "2025-01-31T12:22:30.495056Z"
  }
}
```

### Member Object

```json
{
  "id": "MjZ8NzY1MjY1NTAtNzg3YS00YjU3LTk2MWYtN2EwMThlOTFkOGRj",
  "object": "webhook",
  "name": "memb",
  "format": "json",
  "url": "https://this-url-does't-exist.autentique.com.br/webhooks",
  "event": {
    "id": "76526550-787a-4b57-961f-7a018e91d8dc",
    "object": "event",
    "organization": 1519203,
    "type": "member.created",
    "data": {
      "user": {
        "name": "Felipe Autentique",
        "company": null,
        "email": "felipe@autentique.com.br",
        "phone": null,
        "cpf": "03351152094",
        "birthday": "2002-03-04"
      },
      "group": {
        "uuid": "96d50d5a-b69c-4c84-b2d9-3f37c227cebf",
        "name": "Administrador",
        "organization": 1519203,
        "permissions": {
          "overwrite_permissions": true,
          "create_documents": true,
          "sign_documents": true,
          "delete_documents": true,
          "archive_documents": true,
          "view_documents_gr": true,
          "view_folders_gr": true,
          "actions_folders_gr": true,
          "actions_documents_gr": true,
          "actions_templates_gr": true,
          "actions_members_oz": true,
          "actions_groups_oz": true,
          "actions_webhooks_oz": true,
          "view_documents_oz": true,
          "view_member_documents_oz": true,
          "view_group_documents_oz": true,
          "view_folders_oz": true,
          "view_member_folders_oz": true,
          "view_group_folders_oz": true,
          "actions_documents_oz": true,
          "view_invoices_oz": true,
          "change_plan_oz": true,
          "actions_folders_oz": true,
          "change_appearances_oz": true,
          "change_whitelabel_oz": false,
          "enterprise_access": false
        },
        "configs": {
          "geral": false,
          "sobrescrever_modelos": false,
          "overwrite_template_group": false,
          "sobrescrever_organizacao": false
        }
      },
      "permissions": {
        "overwrite_permissions": false,
        "create_documents": true,
        "sign_documents": true,
        "delete_documents": true,
        "archive_documents": true,
        "view_documents_gr": true,
        "view_folders_gr": true,
        "actions_folders_gr": false,
        "actions_documents_gr": false,
        "actions_templates_gr": false,
        "actions_members_oz": false,
        "actions_groups_oz": false,
        "actions_webhooks_oz": false,
        "view_documents_oz": true,
        "view_member_documents_oz": false,
        "view_group_documents_oz": false,
        "view_folders_oz": true,
        "view_member_folders_oz": false,
        "view_group_folders_oz": false,
        "actions_documents_oz": false,
        "view_invoices_oz": true,
        "change_plan_oz": false,
        "actions_folders_oz": false,
        "change_appearances_oz": false,
        "change_whitelabel_oz": false,
        "enterprise_access": false
      }
    },
    "previous_attributes": [],
    "created_at": "2025-01-31T12:24:48.477885Z"
  }
}
```

## Types of events

Autentique's API uses specific events triggered when certain actions occur.

\
All webhooks sent are related to an event of a specific resource, defined by the "type" field. The content of the webhooks only varies between different event types.

These events are classified into three main categories

* **Document**: Events related to the creation, modification, and completion of documents.
* **Signature**: Events related to the signature flow in documents.
* **Member**: Events related to the members of the organization.

### Document Events

<table><thead><tr><th width="279">Event</th><th>Description</th></tr></thead><tbody><tr><td>document.created</td><td>Triggered when a new document is created in the application.</td></tr><tr><td>document.updated</td><td>Triggered when an existing document is updated or edited (e.g., changes to additional settings).</td></tr><tr><td>document.deleted</td><td>Triggered when a document is permanently deleted from the application.</td></tr><tr><td>document.finished</td><td>Triggered when all signatures or steps associated with the document are successfully completed.</td></tr></tbody></table>

### Signature Events

<table><thead><tr><th width="276">Event</th><th>Description</th></tr></thead><tbody><tr><td>signature.created</td><td>Triggered when a new signature request is created for a signer in a document.</td></tr><tr><td>signature.updated</td><td>Triggered when there is a change or update to the signature request, such as a change in conditions or the signature status (e.g., placing an invisible signature).</td></tr><tr><td>signature.deleted</td><td>Triggered when a pending signer is removed from the document.</td></tr><tr><td>signature.viewed</td><td>Triggered when the signer views the document for the first time, indicating they accessed the content but have not taken any further action.</td></tr><tr><td>signature.accepted</td><td>Triggered when the signer successfully completes the signature process.</td></tr><tr><td>signature.rejected</td><td>Triggered when the signer explicitly declines the signature.</td></tr><tr><td>signature.biometric_approved</td><td>Triggered when the signer's biometric verification is successfully validated by the document creator or through automatic validation.</td></tr><tr><td>signature.biometric_unapproved</td><td>Triggered when a document's signature has pending checks, such as manual validation that remains in an approval state and needs to be completed by the document owner.</td></tr><tr><td>signature.biometric_reset</td><td>Triggered when a manual approval is rejected while the "Request new validation upon rejection" parameter is active.</td></tr><tr><td>signature.biometric_rejected</td><td>Triggered when the biometric verification is rejected by the document author.</td></tr><tr><td>signature.delivery_failed</td><td>Triggered when an error occurs while sending an email to the signer.</td></tr></tbody></table>

### Member Events

<table><thead><tr><th width="279">Event</th><th>Description</th></tr></thead><tbody><tr><td>member.created</td><td>Triggered when a new member joins the organization</td></tr><tr><td>member.deleted</td><td>Triggered when a member is removed from the organization</td></tr></tbody></table>

## *Webhooks* that failed

When a webhook is sent but not successfully received by the registered endpoint, it is added to the list of undelivered webhooks in the error log, available on our [webhook endpoint registration page.](/api/corporate/introducao.md)

Webhooks on this list will undergo up to three additional delivery attempts, made after 60, 120, and 300 seconds. If all attempts fail, the event will remain on the list for up to 14 days.


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/integration-basics/webhooks.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Mensagens de erro (/integration-basics/mensagens-de-erro.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/integration-basics/mensagens-de-erro.md).

# Error messages

The responses returned by the API follow this standard response format:

```javascript
{
  "errors": { ... },
  "data": { ... }
}
```

However, the `errors` attribute is only returned when an exception occurs in the request.

When an invalid GraphQL query error occurs, the exceptions are similar to the example below (e.g., when a required value like `name` is missing in the query specification).

```javascript
{
  "errors": [
    {
      "message": "Variable \"$folder\" got invalid value null at \"folder.name\"; Expected non-nullable type \"String!\" not to be null.",
      "locations": [
        {
          "line": 1,
          "column": 31
        }
      ]
    }
  ]
}
```

Here's an example of a common error when searching for a nonexistent folder:

```javascript
{
  "errors": [
    {
      "message": "Folder not found",
      "locations": [
        {
          "line": 2,
          "column": 3
        }
      ],
      "path": [
        "folder"
      ]
    }
  ],
  "data": {
    "folder": null
  }
}
```

Additionally, there are validation errors (when the `message` attribute has the value "validation"), such as when creating a folder with an empty string value:

```javascript
{
  "errors": [
    {
      "message": "validation",
      "locations": [
        {
          "line": 2,
          "column": 3
        }
      ],
      "path": [
        "createFolder"
      ],
      "extensions": {
        "validation": {
          "folder.name": [
            "field_required"
          ]
        },
        "category": "validation"
      }
    }
  ],
  "data": {
    "createFolder": null
  }
}
```

In the following example, there’s also a validation error, but with variables, which happens when a folder name that is too short is defined:

```javascript
{
  "errors": [
    {
      "message": "validation",
      "locations": [
        {
          "line": 2,
          "column": 3
        }
      ],
      "path": [
        "createFolder"
      ],
      "extensions": {
        "validation": {
          "folder.name": [
            "must_be_at_least_characters:3"
          ]
        },
        "category": "validation"
      }
    }
  ],
  "data": {
    "createFolder": null
  }
}
```

### **Validation Errors**

Lastly, here is a JSON with all the possible error or validation messages that may be returned by the API, along with their meanings and any possible variables in curly brackets (e.g., `{{variable}}`). Note that these do not include GraphQL query errors.

```javascript
{
  "unauthorized": "You are not authenticated anymore",
  "document_not_found": "Document not found",
  "folder_not_found": "Folder not found",
  "document_signed": "The document was already signed",
  "not_your_turn": "It's not your turn to sign the document",
  "must_be_a_string": "It's only allowed text",
  "must_be_an_array": "It's not a list",
  "not_a_valid_date": "It's not a valid date",
  "must_be_a_valid_email_address": "It is not a valid email",
  "must_be_a_file": "It's not a file",
  "failed_to_upload":  "Error sending a file",
  "could_not_upload_file": "It was not possible to send a file",
  "field_required": "This field is mandatory",
  "unavailable_credits": "You’ve run out of documents. You’ve already created all the documents available in your plan.",
  "unavailable_verifications_credits": "Insufficient additional verification credits.",
  "may_not_be_greater_than": "Cant have more than {{max}} characters",
  "must_be_at_least": "Can't have less than {{min}} characters",
  "format_is_invalid": "The field format is incorrect",
  "invalid_date": "It's not a valid date",
  "without_permission": "You need to be an organization administrator to perform this action..",
  "must_be_a_valid_file": "Only files with the following extensions are allowed {{extensions}}",
  "not_a_member_of_organization": "You need to be a member of the same organization to perform this action."
}
```

### Rate Limit Error

If your user exceeds 60 requests per minute, an error with status code 429 will be returned, with the message:

```json
{
    "message": "Too Many Attempts."
}
```


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/integration-basics/mensagens-de-erro.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Query: fetch current user (/queries/fetch-current-user.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/queries/fetch-current-user.md).

# Fetch current user

To retrieve information about the user holding the API token used, you should use the following query:

```graphql
query {
  me {
    id
    name
    email
    phone
    cpf
    cnpj
    birthday
    subscription {
      has_premium_features
      documents
      credits
    }
    organization {
      id
      uuid
      name
      cnpj
    }
  }
}
```

This is an example of a request you can make, and you can choose which data you want to receive or not. A more detailed documentation about all possible fields is available in [Altair](https://altair.autentique.com.br/).

#### Expected respose

```graphql
{
  "data": {
    "me": {
      "id": "1ac41a793ed27015abd0a381eb2846e1c3e7fe01",
      "name": "Mateus Zanella",
      "email": "mateus@autentique.com.br",
      "phone": null,
      "cpf": "012.345.678-90",
      "cnpj": null,
      "birthday": "01/01/2001",
      "subscription": {
        "has_premium_features": false,
        "documents": 20,
        "credits": 200
      },
      "organization": {
        "id": 179,
        "uuid": "91155c91-a411-4d93-b2a4-92e37548256b",
        "name": "Autentique",
        "cnpj": "29.423.653/0001-65"
      }
    }
  }
}
```

{% hint style="info" %}
You can check what each of these parameters means directly in the full GraphQL API documentation, available in the Docs menu of [Altair](https://altair.autentique.com.br/). If you're unsure how to do this, check out our tutorial on [*Using Altair*.](/api/integration-basics/altair.md)
{% endhint %}

{% hint style="info" %}
If Altair doesn’t help you integrate with the API, here are some examples of how to make these requests in other ways: <https://graphql.org/graphql-js/graphql-clients/>
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/queries/fetch-current-user.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Query: resgatando documentos (/queries/resgatando-documentos.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/queries/resgatando-documentos.md).

# Retrieving documents

{% hint style="warning" %}
Avoid using these methods to frequently check the status of signatures. Webhooks are a faster and more efficient way to do this (and our backend will thank you :sweat\_smile: )
{% endhint %}

### Retrieving a specific document

In [Altair](https://altair.autentique.com.br/), you can test with the "Retrieve document" item from the pre-built collection. Don't forget to complete the query with the ID of an existing document to search.

```graphql
# If you copy the query, remember to remove the comments

query {
  document(id: "DOCUMENT ID") {
    id
    name
    refusable
    sortable
    created_at
    files { original signed pades }
    signatures {
      public_id
      name
      email
      created_at
      action { name }
      link { short_link } # Signature link when the signer is added by "name" instead of "email"
      user { id name email phone }
      user_data { name email phone } # Data related to lock_user_data when creating the document
      email_events {
        sent # Email sending timestamp confirmation
        opened # Email open timestamp (may not be registered in some email clients)
        delivered # Email open timestamp (may not be registered in some email clients)
        refused # Email sending error timestamp
        reason # Error message returned when sending fails
      }
      viewed { ...event } # When the signer views
      signed { ...event } # When the signer signs
      rejected { ...event } # When the signer rejects
      signed_unapproved { ...event } # When the signer signs but is pending biometric approval
      biometric_approved { ...event } # When the pending biometric of the signer is approved
      biometric_rejected { ...event } # When the pending biometric of the signer is rejected
    }
  }
}

fragment event on Event {
  ip
  port
  reason
  created_at
  geolocation {
    country
    countryISO
    state
    stateISO
    city
    zipcode
    latitude
    longitude
  }
}
```

You may check the results straight in [Altair](https://altair.autentique.com.br):

<figure><img src="/files/RUW94EUZuTD6Djyygfzw" alt=""><figcaption></figcaption></figure>

Similarly, you can use fragments as a way to avoid repetition in queries with GraphQL.

You can also query multiple documents at once:

```graphql
query {
  first: document(id: "DOCUMENT_ID_1") { name }
  second: document(id: "DOCUMENT_ID_2") { name }
  third: document(id: "DOCUMENT_ID_3") { name }
}
```

<figure><img src="/files/OHDevfnsGofed8eKI9pU" alt=""><figcaption></figcaption></figure>

As shown in the image above, you can also name the queries. (Note: The name cannot contain only numbers).

### Listing Documents

It is also possible to return pages containing multiple documents:

```graphql
query {
  documents(limit: 60, page: 1) {
    total
    data {
      id
      name
      refusable
      sortable
      created_at
      signatures {
        public_id
        name
        email
        created_at
        action { name }
        link { short_link }
        user { id name email }
        viewed { created_at }
        signed { created_at }
        rejected { created_at }
      }
      files { original signed }
    }
  }
}
```

<figure><img src="/files/5HYdWM9CT7yECp2UxTnZ" alt=""><figcaption></figcaption></figure>

#### Retrieving documents from a folder

You can also retrieve the documents contained in a folder:

```graphql
query{
  documentsByFolder(folder_id: "FOLDER_ID", limit: 60, page: 1) {
    data {
      id
      name
      qualified
      sandbox
      created_at
      deleted_at
    }
    has_more_pages
  }
}
```

The *query* itself is practically the same as listing documents, with the only difference being that you can specify a folder ID to perform the search. The information returned is also of the same type as the previous request.

<figure><img src="/files/XYixLz27mBXNwETMmPms" alt=""><figcaption></figcaption></figure>

{% hint style="info" %}
You can check what each of these parameters means directly in the full GraphQL API documentation, in the Docs menu of [Altair](https://altair.autentique.com.br/). If you're not sure how to do that, check out our tutorial on [**Using Altair**](/api/integration-basics/altair.md).
{% endhint %}

{% hint style="info" %}
If Altair doesn't help you integrate with the API, check out some examples of how to make these requests in other ways: <https://graphql.org/graphql-js/graphql-clients/>
{% endhint %}

{% file src="/files/-M03o9cE5QB3vLoPUlzJ" %}
Para importar e usar no Postman
{% endfile %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/queries/resgatando-documentos.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Mutation: criando um documento (/mutations/criando-um-documento.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/mutations/criando-um-documento.md).

# Creating a document

Creating documents differs slightly from other mutations because it involves uploading a file. First, we need to write the *mutation*:

<pre class="language-graphql"><code class="lang-graphql">mutation CreateDocumentMutation(
  $document: DocumentInput!, # Definition of the $document variable
  $signers: [SignerInput!]!, # $signers and $file, with its respective
  $file: Upload!             # types. (The "!" indicate that are
<strong>) {                          # mandatory parameters)      
</strong>  createDocument(
    document: $document,     # Pass the variable values to the mutation parameters
    signers: $signers,       # 
    file: $file,             #
    organization_id: 123,    # OPTIONAL: Creates in other user organizations, otherwise uses the current one
    folder_id: "a1b2c3"      # OPtIONAL: Creates archived in a folder
  ) {
    id
    name
    refusable
    sortable
    created_at
    signatures {
      public_id
      name
      email
      created_at
      action { name }
      link { short_link }
      user { id name email }
    }
  }
}
</code></pre>

{% hint style="info" %}
Maximum file size is 5MB on the free plan and 20MB on the professional plan!
{% endhint %}

Next, we need the values of the variables defined in the mutation in a JSON:

{% code overflow="wrap" %}

```json
/*
 Below, a signer will receive the signature link by email when the "email" field is provided, for a signer added with "name", the "link" attribute will be returned in the document with the signature link.
When using "phone", there are two possible delivery methods defined by the "delivery_method" attribute:
"DELIVERY_METHOD_WHATSAPP" to send via WhatsApp and "DELIVERY_METHOD_SMS" to send via SMS.
*/

{
  "document": {
    "name": "Marketing contract"
  },
  "signers": [{
    "email": "change-this-public-email@example.com",
    "action": "SIGN"
  }, {
    "name": "Ronaldo Fuzinato",
    "action": "SIGN"
  }, {
    "phone": "+5554999999999",
    "delivery_method": "DELIVERY_METHOD_WHATSAPP",
    "action": "SIGN"
  }, {
    "phone": "+5554999999998",
    "delivery_method": "DELIVERY_METHOD_SMS",
    "action": "SIGN"
  }]
}
```

{% endcode %}

Notice that no value has been provided for the `$file` variable? That's because since the file is being uploaded, the request needs to be sent as `multipart/form-data`, so the file must be handled a bit differently. You can do this directly in  [Altair](https://altair.autentique.com.br/):

<figure><img src="/files/iVY02GSWe0S9zk0nBKq8" alt=""><figcaption></figcaption></figure>

{% hint style="warning" %}
If you're unsure how document submission works for your integration, this repository provides more information and examples on how to handle the upload: <https://github.com/jaydenseric/graphql-multipart-request-spec>.
{% endhint %}

### Creating documents on Sandbox

Our API also supports sending test documents, which do not consume document credits, making integration easier for those who have not yet acquired a plan with unlimited documents. To learn how to do this, visit our [sandbox page](/api/integration-basics/sandbox-testes.md).

### More options:

```json
// IMPORTANT:
// - If you copy this JSON, remove the comments before using it
// - Some of the attributes below will not work without a corporate plan
// - Some of the attributes below will consume additional verification credits

{
  "document": {
    "name": "Marketing contract",
    "message": "Custom message sent to the signer's email",
    "reminder": "WEEKLY", // Weekly signature reminder. DAILY to daily reminder
    "whatsapp_template": "STANDARD", //Selects WhatsApp template. Also accepts the values FORMAL, CASUAL and DIRECT 
    "sortable": true, // Signers sign on the array order "signers"
    "footer": "BOTTOM", // Adds footer. Also accepts the values LEFT and RIGHT
    "refusable": true, // Allows document rejection
    "qualified": true, // Enables qualified signature using certificates
    "scrolling_required": true, // Only allows document signing if the signer has scrolled through the entire page
    "stop_on_rejected": true, // Prevents others from signing when rejected
    "new_signature_style": true, // Enables new signature fields
    "show_audit_page": false, // Prevents creating the last audit page in documents with "new_signature_style": true
    "ignore_cpf": true, // Removes the requirement to fill in CPF to sign and removes any reference to CPF in the platform interface
    "ignore_birthdate": true // Removes the requirement to fill in the date of birth and removes any reference to the date of birth in the platform interface
    "email_template_id": 1234, // Uses a specific email template by its ID
    "deadline_at": "2023-11-24T02:59:59.999Z", // Blocks signatures after date
    "cc": [
      // Sends emails when the document is signed by all signers
      { "email": "email-cc-1@example.com" },
      { "email": "email-cc-2@example.com" }
    ],
    "expiration": {
      // Sends a reminder "days_before" days before the document’s due date specified in "notify_at"
      "days_before": 7,
      "notify_at": "20/01/2026"
    },
    "configs": {
      "notification_finished": true, // Sends an email notifying all signers that the document has been signed by all parties
      "notification_signed": true, // Sends an email to the signer notifying that they signed the document
      "signature_appearance": "ELETRONIC", // Forces the signature appearance, can be: DRAW, HANDWRITING, ELECTRONIC, IMAGE
      "keep_metadata": true, // Keeps PDF metadata in qualified signature
      "lock_user_data": true // Keeps outdated user data, showing the information used at the time of signing
    },
    "locale": {
      "country": "BR", // Any country in ISO3166 format, if not provided, defaults to BR
// IMPORTANT The creation of non-Brazilian documents has the following points:
// - Signers with SMS delivery method are not supported. In these cases,
// the request returns the error: sms_delivery_not_allowed_on_foreign_documents;
// - The fields new_signature_style and ignore_cpf are set to true;
// - CPF elements placed on the document pages are ignored;
// - Additional verifications from SERPRO and via SMS are ignored.
      "language": "pt-BR", // Can be: pt-BR or en-US, if not provided, defaults to pt-BR
      "timezone": "America/Sao_Paulo", // DateTimeZone with all time zones, if not provided, defaults to America/Sao_Paulo
// A complete list can be found at: https://www.php.net/manual/en/datetimezone.listidentifiers.php
      "date_format": "DD_MM_YYYY", // Enum, can be: DD_MM_YYYY or MM_DD_YYYY, if not provided, defaults to DD_MM_YYYY
    } 
  },
  "signers": [{
    "email": "change-this-public-email@example.com", // Envia email
    "action": "SIGN", // Sign
    "configs": { "cpf": "12345678900" }, // Validates the cpf of the signer
    "security_verifications": [
      // Require SMS verification ("verify_phone" is optional):
      { "type": "SMS", "verify_phone": "+5554999999999" },
      // Require photo ID (Manual approval)
      { "type": "MANUAL" }
    ],
    //Positions signature fields:
    "positions": [{"x": "5.0", "y": "90.0", "z": 1, "element": "SIGNATURE"}]
  }, {
    "name": "Ronaldo Fuzinato", // Receives signature links to send
    "action": "SIGN_AS_A_WITNESS", // Sign as a witness
    // Require photo ID (Photo ID)
    "security_verifications": [{ "type": "UPLOAD" }],
    // Position fields for name of the signer
    "positions": [{"x": "75.0", "y": "90.0", "z": 1, "element": "NAME"}]
  }, {
    "email": "change-this-public-email-2@example.com", // Send email
    "action": "APPROVE", // Approve
    // Require photo ID (Document, selfie, and liveness check)
    "security_verifications": [{ "type": "LIVE" }],
    // Positions initials fields
    "positions": [{"x": "25.0", "y": "90.0", "z": 1, "element": "INITIALS"}]
  }, {
    "phone": "+5521999999999",
    "delivery_method": "DELIVERY_METHOD_SMS", // Send SMS to "phone"
    "action": "RECOGNIZE", // Acknowledge
    // Demand Photo ID (SERPRO biometrics):
    "security_verifications": [{ "type": "PF_FACIAL" }],
    // Position fields of signature date:
    "positions": [{"x": "55.0", "y": "90.0", "z": 1, "element": "DATE"}]
  }, {
    "phone": "+5521999999998",
    "delivery_method": "DELIVERY_METHOD_WHATSAPP", // Sends whatsapp to "phone"
    "action": "SIGN", // Sign
    // Position CPF fields:
    "positions": [{"x": "55.0", "y": "90.0", "z": 1, "element": "CPF"}]
  }]
}
```

### &#x20;Additional Validations

You can implement additional validations in your documents. These configurations must be included in the `security_verifications` list of the signer object, using the `type` field to define the desired challenge modality. In addition to the types, fields such as `verify_phone` and `cpf` assist in the delivery of security codes and in the precise identification of the signer.

| Field / Verification Type       | How it works                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verify_phone`                  | The signer must validate a mobile number through a code sent via SMS. You can pre-fill the number or leave it blank so the signer can provide it themselves.                                                             |
| `cpf`                           | Configuration that ensures only the signer with the specified CPF can sign the document. If defined, the system forces the entry or validation of this data in the signer's account                                      |
| `MANUAL`                        | The signer will attach a photo ID and take a selfie. You or a member of your organization can then approve or reject the submitted documents and selfie                                                                  |
| `UPLOAD`                        | The signer must attach the front and back of a photo ID using their smartphone or computer                                                                                                                               |
| `LIVE`                          | The signer will need to attach a photo ID, take a selfie with their smartphone, and perform a liveness check (video). The document photo will be automatically compared to the selfie to verify the degree of similarity |
| `PF_FACIAL`                     | The signer takes a selfie which is validated by SERPRO, comparing it to Brazilian government registration photos linked to the informed CPF                                                                              |
| `BIOMETRIC_AND_TEXT_EXTRACTION` | The signer will need to photograph an ID document and take a selfie, the document photo will be compared with the selfie to determine the similarity score.                                                              |
| `LIVENESS_AND_TEXT_EXTRACTION`  | The signer will need to perform a liveness check and photograph a photo ID. Document information will be automatically extracted and compared to verify the similarity score.                                            |

<details>

<summary><strong>Positioning signature fields "positions"</strong></summary>

As shown in the example above, to add signature fields when creating the document, you need to include the "positions" attribute.

```json
{
  ...
  "signers": [
    {
      ...
      "positions": [
        { "x": "100.0", "y": "100.0", "z": 1, "element": "SIGNATURE" }
      ]﻿
    }
  ]﻿
}
```

The “x” value represents the horizontal position, ranging from 0% to 100%.\
The “y” value represents the vertical position, also ranging from 0% to 100%.\
The “z” value indicates the page number, starting at 1.

\
﻿O `"element"` It's the type of signature\
﻿`"SIGNATURE"`: Signature\
`"NAME"`: Signer's name\
`"INITIALS"`: Initials\
`"DATE"`: Signature date\
`"CPF"`: Signer CPF

To know what positions to pass for x and y, you can create a sample document in the Autentique dashboard and retrieve the positions by fetching the document using "positions":

```graphql
query {
  document(id: "DOCUMENT_ID") {
    id
    signatures {
      public_id
      positions {
        element
        x
        y
        z
      }
    }
  }
}
```

</details>

<details>

<summary><strong>Require SMS verification and/or photo document verification "security_verifications"</strong></summary>

To require signers to verify via SMS and/or photo document, you need to add the "security\_verifications" attribute to the signer for whom these verifications should be required. Remember to check in the dashboard for the cost of additional verification credits needed.

```json
{
  ...
  "signers": [
    {
      ...
      "security_verifications": [
        { "type": "SMS", "verify_phone": "+5554999999999" },
        { "type": "MANUAL" }
      ]﻿
    },
    {
      ...
      "security_verifications": [
        { "type": "BIOMETRIC_AND_TEXT_EXTRACTION" }
      ]﻿
    },
    {
      ...
      "security_verifications": [
        { "type": "BIOMETRIC_AND_TEXT_EXTRACTION", "fallback_behavior": "DISABLE_FALLBACK" }
      ]﻿
    }
  ]﻿
}

```

The "type" is the type of verification:

* **"`SMS`"**: SMS validation ("verify\_phone" is optional and requires a specified phone number)
* **"`MANUAL`"**: Require a photo document (manual approval)
* **"`UPLOAD`"**: Require a photo document (photo document)
* **"`LIVE`"**: Require a photo document (document, selfie, and proof of life)
* **"`PF_FACIAL`"**: Require a photo document (SERPRO biometric verification)
* "**`BIOMETRIC_AND_TEXT_EXTRACTION`**": Require a photo document (photo document and facematch)

While it's possible to have multiple verifications for the same signer, you can only choose one of the following options per signer: **`MANUAL`**, **`UPLOAD`**, **`LIVE`**, and **`PF_FACIAL`**.

\
When the types **`UPLOAD`**, **`LIVE`**, **`PF_FACIAL`** and **`BIOMETRIC_AND_TEXT_EXTRACTION`** are used, there is a default behavior where they are changed to `MANUAL` when the signer exceeds the maximum number of attempts in the document validation process. \
To disable this behavior, you must use the `fallback_behavior` parameter, which will flag the document as failed and automatically reject it.

</details>

<details>

<summary><strong>Create a document from a template</strong></summary>

There is no way in the API to directly use the panel templates to create documents. However, you can achieve something similar through your code:

1. **Create a fixed HTML template** on your machine, marking the places with variables to be replaced by values. (e.g., "I, $NomeSignatario$, accept this contract")
2. **Programmatically duplicate this HTML** and in the duplicate, replace the variable fields with the actual values. (e.g., `$NomeSignatario$` → Jorge Silva)
3. **Send this HTML file** with the replaced values to our API through the `createDocument` mutation, just like it works for other types of files.

</details>

<details>

<summary><strong>Example of document creation with NodeJS</strong></summary>

If you use Postman, you can generate these examples from the Postman collection provided here in the [documentation](https://docs.autentique.com.br/api/).

```javascript
var axios = require('axios');
var FormData = require('form-data');
var fs = require('fs');
var data = new FormData();
data.append('operations', '{"query":"mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {createDocument(document: $document, signers: $signers, file: $file) {id name refusable sortable created_at signatures { public_id name email created_at action { name } link { short_link } user { id name email }}}}", "variables":{"document": {"name": "Test contract"},"signers": [{"email": "change-this-public-email@example.com","action": "SIGN"}],"file":null}}');
data.append('map', '{"file": ["variables.file"]}');
data.append('file', fs.createReadStream('/path/to/file'));
var config = {
  method: 'post',
  url: 'https://api.autentique.com.br/v2/graphql',
  headers: {
    'Authorization': 'Bearer API_TOKEN',
    ...data.getHeaders()
  },
  data : data
};
axios(config)
  .then(function(response) { console.log(JSON.stringify(response.data)); })
  .catch(function(error) { console.log(error); });
```

For this example, just replace the API token, the signer's email, and the file path.

</details>

<details>

<summary><strong>Example of document creation with PHP</strong></summary>

If you use Postman, you can generate these examples from the Postman collection provided here in the documentation [documentation](https://docs.autentique.com.br/api/).

```php
<?php

$curl = curl_init();
curl_setopt_array($curl, array(
  CURLOPT_URL => 'https://api.autentique.com.br/v2/graphql',
  CURLOPT_CUSTOMREQUEST => 'POST',
  CURLOPT_POSTFIELDS => array('operations' => '{"query":"mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {createDocument(document: $document, signers: $signers, file: $file) {id name refusable sortable created_at signatures { public_id name email created_at action { name } link { short_link } user { id name email }}}}", "variables":{"document": {"name": "Contrato de teste"},"signers": [{"email": "change-this-public-email@example.com","action": "SIGN"}],"file":null}}','map' => '{"file": ["variables.file"]}','file'=> new CURLFILE('/path/to/file')),
  CURLOPT_HTTPHEADER => array('Authorization: Bearer API_TOKEN'),
));
$response = curl_exec($curl);
curl_close($curl);
echo $response;
```

In this example, you just need to replace the API token, the signer's email, and the file path.

</details>

<details>

<summary><strong>Example of document creation with Python3</strong></summary>

If you use Postman, you can generate these examples from the Postman collection provided here in the documentation [documentation](https://docs.autentique.com.br/api/).

```python
import requests

url = "https://api.autentique.com.br/v2/graphql"
payload = {
  'operations': '{"query":"mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {createDocument(document: $document, signers: $signers, file: $file) {id name refusable sortable created_at signatures { public_id name email created_at action { name } link { short_link } user { id name email }}}}", "variables":{"document": {"name": "Test contract"},"signers": [{"email": "change-this-public-email@example.com","action": "SIGN"}],"file":null}}',
  'map': '{"file": ["variables.file"]}'
}
files = [
  ('file',open('/path/to/file.pdf','rb'))
]
headers = {
  'Authorization': 'Bearer API_TOKEN'
}

response = requests.request("POST", url, headers=headers, data=payload, files=files)
print(response.text)
```

In this example, you just need to replace the API token, the signer's email, and the file path.

</details>

<details>

<summary><strong>Example of document creation with C#</strong></summary>

If you use Postman, you can generate these examples from the Postman collection provided here in the documentation [documentation](https://docs.autentique.com.br/api/).

```csharp
var client = new RestClient("https://api.autentique.com.br/v2/graphql");
var request = new RestRequest(Method.POST);

request.AddHeader("Authorization", "Bearer API_TOKEN");
request.AddParameter("operations", "{\"query\":\"mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {createDocument(document: $document, signers: $signers, file: $file) {id name refusable sortable created_at signatures { public_id name email created_at action { name } link { short_link } user { id name email }}}}\", \"variables\":{\"document\": {\"name\": \"Contrato de teste\"},\"signers\": [{\"email\": \"change-this-public-email@example.com\",\"action\": \"SIGN\"}],\"file\":null}}");
request.AddParameter("map", "{\"file\": [\"variables.file\"]}");
request.AddFile("file", "/path/to/file");
IRestResponse response = client.Execute(request);

Console.WriteLine(response.Content);
```

In this example, you just need to replace the API token, the signer's email, and the file path.

</details>

{% hint style="info" %}
You can check what each of these parameters means directly in the full GraphQL API documentation, in the Docs menu of [Altair](https://altair.autentique.com.br/). If you're not sure how to do that, check out our tutorial on [**Using Altair**](/api/integration-basics/altair.md).
{% endhint %}

{% file src="/files/-M03o9cE5QB3vLoPUlzJ" %}
Para importar e usar no Postman
{% endfile %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/mutations/criando-um-documento.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Mutation: assinando um documento (/mutations/assinando-um-documento.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/mutations/assinando-um-documento.md).

# Signing a document

To do so, simply use the following mutation:\
\&#xNAN;*(Don’t forget to replace it with the ID of an existing document.)*

```graphql
mutation {
  signDocument(id: "DOCUMENT_ID")
}
```

Please note that you can **only sign using the account linked to the API token**. This means you **cannot** use this method to enable others to sign documents directly through your application.

Additionally, you will **only be able to sign a document if you are listed as one of its signers**. Otherwise, the response will return the error: `signature_not_found`.

You can test the signing process in [Altair](https://altair.autentique.com.br):

<figure><img src="/files/ufFTj9pY24sCFuFQVcBT" alt=""><figcaption></figcaption></figure>

{% hint style="info" %}
You can check what each of these parameters means directly in the full GraphQL API documentation, in the Docs menu of [Altair](https://altair.autentique.com.br/). If you're not sure how to do that, check out our tutorial on [**Using Altair**](/api/integration-basics/altair.md).
{% endhint %}

{% hint style="info" %}
If Altair doesn't help you integrate with the API, check out some examples of how to make these requests in other ways: <https://graphql.org/graphql-js/graphql-clients/>
{% endhint %}

{% file src="/files/-M03o9cE5QB3vLoPUlzJ" %}
Para importar e usar no Postman
{% endfile %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/mutations/assinando-um-documento.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Mutation: create signature link (/mutations/create-signature-link.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/mutations/create-signature-link.md).

# Create signature link

To create a signing link, use the following mutation:

```graphql
mutation{
  createLinkToSignature(
    public_id: "SIGNATURE_ID"
  ){
    short_link
  }
}
```

#### Parameters

* `public_id` parameter of the signature for which you want to generate the link.

{% hint style="warning" %}
This link is exclusive for the designed signer. Please, make sure to not share it with third parties.
{% endhint %}

#### Expected response:

```json
{
  "data": {
    "createLinkToSignature": {
      "short_link": "https://assina.ae/A9pQN40FuNc10Na8K8"
    }
  }
}
```

{% hint style="info" %}
If Altair doesn't help you integrate with the API, check out some examples of how to make these requests in other ways: <https://graphql.org/graphql-js/graphql-clients/>
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/mutations/create-signature-link.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Mutation: resend signatures (/mutations/resend-signatures.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/mutations/resend-signatures.md).

# Resend signatures

To resend a signature, use the following *mutation:*

```graphql
mutation{
  resendSignatures(public_ids: [
    "SIGNATURE_ID_1",
    "SIGNATURE_ID_2",
    "..."
  ])
}
```

#### Paramaters

* **public\_ids**: A list of signature IDs to be resent. These represent the `public_id` field of the signatures.

{% hint style="info" %}
This mutation accounts for the possibility that some resends may be in a timeout state. If **all** of the signature IDs have already been resent recently, you will receive the error `too_many_resent_emails`. If **only some** of them are within the resend limit, those will be skipped, and the remaining signatures will be resent.
{% endhint %}

#### Expected response

```json
{
  "data": {
    "resendSignatures": true
  }
}
```

{% hint style="info" %}
If Altair doesn't help you integrate with the API, check out some examples of how to make these requests in other ways: <https://graphql.org/graphql-js/graphql-clients/>
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/mutations/resend-signatures.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.



<!-- ============ Mutation: adding a signer (/mutations/adding-a-signer.md) ============ -->

> For the complete documentation index, see [llms.txt](https://docs.autentique.com.br/api/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.autentique.com.br/api/mutations/adding-a-signer.md).

# Adding a signer

To add a signer to a document, you can use the following mutation.

**Mutation definition:**

Here is the mutation definition for adding a signer:

```graphql
mutation(
  $document_id: UUID!,
  $signer: SignerInput
) {
  createSigner(
    document_id: $document_id 
    signer: $signer
  ) {
    public_id
    name
    email
    delivery_method
    action { name }
    link {
      id
      short_link 
    }
    created_at
  }
}
```

**Parameters:**

* `document_id`: The unique identifier of the document to which you want to add a signer.
* `signer`: Contains the details of the signer being added. This object requires careful attention to both required and optional fields, as defined in our **SignerInput** specification.

After defining the mutation, you need to assign values to the declared variables using a **JSON object**.

```json
{
  "document_id": "DOCUMENT_ID",
    "signer": { 
      "email": "change-this-email-that-is-also-public@example.com",
      "action": "SIGN"
    }
}
```

Remember to replace the placeholder values by providing the **document ID** and **signer information**, which are the same as those mentioned in:[Creating a document](/api/mutations/criando-um-documento.md).

#### Expected response: the response will include details about the created signer, as defined in the mutation.

#### &#x20;Here is an example of the expected response:

```json
{
  "data": {
    "createSigner": {
      "public_id": "434fcd4c6d0c11eea3c542010a2b60c6",
      "name": null,
      "email": "change-this-email-that-is-also-public@example.com",
      "delivery_method": "DELIVERY_METHOD_EMAIL",
      "action": {
        "name": "SIGN"
      },
      "link": null,
      "created_at": "2023-10-17T16:43:13.000000Z"
    }
  }
}
```

The **link** field will provide the signing URL for the signer, if they were added using the parameter `"delivery_method": "DELIVERY_METHOD_LINK"`.

{% hint style="info" %}
You can check what each of these parameters means directly in the full GraphQL API documentation, in the Docs menu of [Altair](https://altair.autentique.com.br/). If you're not sure how to do that, check out our tutorial on [**Using Altair**](/api/integration-basics/altair.md).
{% endhint %}

{% hint style="info" %}
If Altair doesn't help you integrate with the API, check out some examples of how to make these requests in other ways: <https://graphql.org/graphql-js/graphql-clients/>
{% endhint %}


---

# Agent Instructions
This documentation is published with GitBook. GitBook is the documentation platform designed so that both humans and AI agents can read, navigate, and reason over technical content effectively. Learn more at gitbook.com.

## Querying This Documentation
If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter, and the optional `goal` query parameter:

```
GET https://docs.autentique.com.br/api/mutations/adding-a-signer.md?ask=<question>&goal=<endgoal>
```

`ask` is the immediate question: it should be specific, self-contained, and written in natural language.
`goal` is optional and describes the broader end goal you are ultimately trying to accomplish on behalf of the user. GitBook uses it to tailor the answer towards what is most useful for that goal.

The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.

