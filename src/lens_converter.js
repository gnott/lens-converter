"use strict";

var _ = require("underscore");
var util = require("substance-util");
var errors = util.errors;
var ImporterError = errors.define("ImporterError");


// Available configurations
// --------

var ElifeConfiguration = require("./configurations/elife");
var LandesConfiguration = require("./configurations/landes");
var DefaultConfiguration = require("./configurations/default");
var PLOSConfiguration = require("./configurations/plos");

var LensImporter = function(options) {
  this.options;
};

LensImporter.Prototype = function() {

  // Helpers
  // --------

  var _getName = function(nameEl) {
    var names = [];

    var surnameEl = nameEl.querySelector("surname");
    var givenNamesEl = nameEl.querySelector("given-names");

    if (givenNamesEl) names.push(givenNamesEl.textContent);
    if (surnameEl) names.push(surnameEl.textContent);

    return names.join(" ");
  };

  var _toHtml = function(el) {
    var tmp = document.createElement("DIV");
    tmp.appendChild(el.cloneNode(true));
    return tmp.innerHTML;
  };


  this.getNodeType = function(el) {
    if (el.nodeType === Node.TEXT_NODE) {
      return "text";
    } else if (el.nodeType === Node.COMMENT_NODE) {
      return "comment";
    } else {
      return el.tagName.toLowerCase();
    }
  };

  // ### The main entry point for starting an import

  this.import = function(input) {
    var xmlDoc;

    // Note: when we are using jqueries get("<file>.xml") we
    // magically get a parsed XML document already
    if (_.isString(input)) {
      var parser = new DOMParser();
      xmlDoc = parser.parseFromString(input,"text/xml");
    } else {
      xmlDoc = input;
    }

    // Creating the output Document via factore, so that it is possible to
    // create specialized NLMImporter later which would want to instantiate
    // a specialized Document type
    var doc = this.createDocument();

    // For debug purposes
    window.doc = doc;

    // A deliverable state which makes this importer stateless
    var state = new LensImporter.State(xmlDoc, doc);

    // Note: all other methods are called corresponding
    return this.document(state, xmlDoc);
  };

  // Overridden to create a Lens Article instance
  this.createDocument = function() {
    var Article = require("lens-article");
    var doc = new Article();
    return doc;
  };

  var _viewMapping = {
    // "image": "figures",
    "supplement": "figures",
    "figure": "figures",
    "table": "figures",
    "video": "figures"
  };

  this.show = function(state, nodes) {
    var doc = state.doc;

    _.each(nodes, function(n) {
      var view = _viewMapping[n.type] || "content";
      doc.show(view, n.id);
    });
  };

  this.front = function(state, front) {
    var articleMeta = front.querySelector("article-meta");
    if (!articleMeta) {
      throw new ImporterError("Expected element: 'article-meta'");
    }
    
    var doc = state.doc;
    var docNode = doc.get("document");
    var cover = {
      id: "cover",
      type: "cover",
      title: docNode.title,
      authors: docNode.authors,
      abstract: docNode.abstract
    };
    doc.create(cover);
    doc.show("content", cover.id);

    this.articleMeta(state, articleMeta);
  };

  // Note: Substance.Article supports only one author.
  // We use the first author found in the contribGroup for the 'creator' property.
  this.contribGroup = function(state, contribGroup) {
    var i;
    var affiliations = contribGroup.querySelectorAll("aff");
    for (i = 0; i < affiliations.length; i++) {
      this.affiliation(state, affiliations[i]);
    }

    var contribs = contribGroup.querySelectorAll("contrib");
    for (i = 0; i < contribs.length; i++) {
      this.contributor(state, contribs[i]);
    }
  };

  this.affiliation = function(state, aff) {
    var doc = state.doc;

    //TODO: this needs a proper specification in Lens.Article
    var institutionNode = {
      id: state.nextId("institution"),
      source_id: aff.getAttribute("id"),
      type: "institution",
    };

    // TODO: fill the node
    // var label = aff.querySelector("label");
    // if (label) institutionNode.label = label.textContent;

    // var name = aff.querySelector("institution");
    // if (name) institutionNode.name = name.textContent;

    doc.create(institutionNode);
  };

  this.contributor = function(state, contrib) {
    var doc = state.doc;

    var id = state.nextId("person");
    var personNode = {
      id: id,
      source_id: contrib.getAttribute("id"),
      type: "person",
      name: "",
      affiliations: [],
      // Not yet supported... need examples
      image: "",
      emails: [],
      contribution: ""
    };

    var nameEl = contrib.querySelector("name");
    personNode.name = _getName(nameEl);

    // extract affiliations stored as xrefs
    var xrefs = contrib.querySelectorAll("xref");
    for (var i = 0; i < xrefs.length; i++) {
      var xref = xrefs[i];
      if (xref.getAttribute("ref-type") === "aff") {
        personNode.affiliations.push(xref.getAttribute("rid"));
      }
    }

    if (contrib.getAttribute("contrib-type") === "author") {
      doc.nodes.document.authors.push(id);
    }

    doc.create(personNode);
  };

  // Annotations
  // --------

  var _annotationTypes = {
    "bold": "strong",
    "italic": "emphasis",
    "monospace": "code",
    "sub": "subscript",
    "sup": "superscript",
    "underline": "underline",
    "ext-link": "link",
    "xref": ""
  };

  this.isAnnotation = function(type) {
    return _annotationTypes[type] !== undefined;
  };



  this.createAnnotation = function(state, el, start, end) {
    var type = el.tagName.toLowerCase();
    var anno = {
      path: _.last(state.stack).path,
      range: [start, end],
    };
    if (type === "xref") {
      var refType = el.getAttribute("ref-type");

      var sourceId = el.getAttribute("rid");
      if (refType === "bibr") {
        anno.type = "citation_reference";
      } else if (refType === "fig" || refType === "table" || "supplementary-material") {
        anno.type = "figure_reference";
      } else {
        console.log("Ignoring xref: ", refType, el);
        return;
      }

      var targetNode = state.doc.getNodeBySourceId(sourceId);
      anno.target = targetNode ? targetNode.id : sourceId;
    }
    // Common annotations (e.g., emphasis)
    else if (_annotationTypes[type] !== undefined) {
      anno.type = _annotationTypes[type];
      if (type === "ext-link") {
        anno.url = el.getAttribute("xlink:href");
      }
    }
    else {
      console.log("Ignoring annotation: ", type, el);
      return;
    }

    anno.id = state.nextId(anno.type);
    state.annotations.push(anno);
  };

  this.annotatedText = function(state, iterator, charPos, nested) {
    var plainText = "";

    for (; iterator.pos < iterator.length; iterator.pos++) {
      var el = iterator.childNodes[iterator.pos];

      // Plain text nodes...
      if (el.nodeType === Node.TEXT_NODE) {
        plainText += el.textContent;
        charPos += el.textContent.length;
      }

      // Annotations...
      else {

        var type = this.getNodeType(el);
        if (this.isAnnotation(type)) {

          var start = charPos;

          var childIterator = {
            childNodes: el.childNodes,
            length: el.childNodes.length,
            pos: 0
          };

          // recurse into the annotation element to collect nested annotations
          // and the contained plain text
          var annotatedText = this.annotatedText(state, childIterator, charPos, "nested");

          plainText += annotatedText;
          charPos += annotatedText.length;

          this.createAnnotation(state, el, start, charPos);
        }

        // Unsupported...
        else {
          if (nested) {
            throw new ImporterError("Node not yet supported in annoted text: " + type);
          }
          else {
            // on paragraph level other elements can break a text block
            // we shift back the position and finish this call
            iterator.pos--;
            break;
          }
        }
      }
    }
    return plainText;
  };


  // Parser
  // --------
  // These methods are used to process XML elements in
  // using a recursive-descent approach.


  // ### Top-Level function that takes a full NLM tree
  // Note: a specialized converter can derive this method and
  // add additional pre- or post-processing.

  this.document = function(state, xmlDoc) {
    // Setup configuration objects
    var publisherName = xmlDoc.querySelector("publisher-name").textContent;
    if (publisherName === "Landes Bioscience") {
      state.config = new LandesConfiguration();
    } else if (publisherName === "eLife Sciences Publications, Ltd") {
      state.config = new ElifeConfiguration();
    } else if (publisherName === "Public Library of Science") {
      state.config = new PLOSConfiguration();
    } else {
      state.config = new DefaultConfiguration();
    }

    var doc = state.doc;
    var article = xmlDoc.querySelector("article");

    if (!article) {
      throw new ImporterError("Expected to find an 'article' element.");
    }



    // recursive-descent for the main body of the article
    this.article(state, article);

    // post-processing:

    // Creating the annotations afterwards, to make sure
    // that all referenced nodes are available
    for (var i = 0; i < state.annotations.length; i++) {
      doc.create(state.annotations[i]);
    }

    // Rebuild views to ensure consistency
    _.each(doc.views, function(view) {
      doc.get(view).rebuild();
    });

    return doc;
  };


  this.extractFigures = function(state, xmlDoc) {
    // Globally query all figure-ish content, <fig>, <supplementary-material>, <table-wrap>, <media video>
    // mimetype="video"
    var figureElements = xmlDoc.querySelectorAll("fig, table-wrap, supplementary-material, media[mimetype=video]");
    var figureNodes = [];
    var node;

    for (var i = 0; i < figureElements.length; i++) {
      var figEl = figureElements[i];
      var type = this.getNodeType(figEl);

      if (type === "fig") {
        // nodes = nodes.concat(this.paragraph(state, child));
        node = this.figure(state, figEl);
        if (node) figureNodes.push(node);
      }
      else if (type === "table-wrap") {
        node = this.tableWrap(state, figEl);
        if (node) figureNodes.push(node);
        // nodes = nodes.concat(this.section(state, child));
      } else if (type === "media") {
        node = this.video(state, figEl);
        if (node) figureNodes.push(node);
      } else if (type === "supplementary-material") {
        
        node = this.supplement(state, figEl);
        if (node) figureNodes.push(node);
      }
    }

    // Show the figures
    if (figureNodes.length > 0) {
      this.show(state, figureNodes);
    }
  };



  this.extractCitations = function(state, xmlDoc) {
    var refList = xmlDoc.querySelector("ref-list");
    if (refList) {
      this.refList(state, refList);
    }
  };

  // Handle <fig> element
  // --------
  // 

  this.figure = function(state, figure) {
    var doc = state.doc;

    var label = figure.querySelector("label");

    // Top level figure node
    var figureNode = {
      "type": "figure",
      "id": state.nextId("figure"),
      "source_id": figure.getAttribute("id"),
      "label": label ? label.textContent : "",
      "url": "http://images.wisegeek.com/young-calico-cat.jpg",
      "caption": null
    };
    
    // Add a caption if available
    var caption = figure.querySelector("caption");
    if (caption) {
      var captionNode = this.caption(state, caption);
      if (captionNode) figureNode.caption = captionNode.id;
    }

    // Lets the configuration patch the figure node properties
    state.config.enhanceFigure(state, figureNode, figure);
    doc.create(figureNode);

    return figureNode;
  };

  // Handle <supplementary-material> element
  // --------
  // 
  // eLife Example:
  // 
  // <supplementary-material id="SD1-data">
  //   <object-id pub-id-type="doi">10.7554/eLife.00299.013</object-id>
  //   <label>Supplementary file 1.</label>
  //   <caption>
  //     <title>Compilation of the tables and figures (XLS).</title>
  //     <p>This is a static version of the 
  //       <ext-link ext-link-type="uri" xlink:href="http://www.vaxgenomics.org/vaxgenomics/" xmlns:xlink="http://www.w3.org/1999/xlink">
  //         Interactive Results Tool</ext-link>, which is also available to download from Zenodo (see major datasets).</p>
  //     <p>
  //       <bold>DOI:</bold>
  //       <ext-link ext-link-type="doi" xlink:href="10.7554/eLife.00299.013">http://dx.doi.org/10.7554/eLife.00299.013</ext-link>
  //     </p>
  //   </caption>
  //   <media mime-subtype="xlsx" mimetype="application" xlink:href="elife00299s001.xlsx"/>
  // </supplementary-material>
  // 
  // LB Example:
  // 
  // <supplementary-material id="SUP1" xlink:href="2012INTRAVITAL024R-Sup.pdf">
  //   <label>Additional material</label>
  //   <media xlink:href="2012INTRAVITAL024R-Sup.pdf"/>
  // </supplementary-material>

  this.supplement = function(state, supplement) {
    var doc = state.doc;
    var that = this;

    //get supplement info
    var label = supplement.querySelector("label");

    var url = "http://meh.com";
    var doi = supplement.querySelector("object-id[pub-id-type='doi']");
    doi = doi ? "http://dx.doi.org/" + doi.textContent : "";    

    //create supplement node using file ids
    var supplementNode = {
      "id": state.nextId("supplement"),
      "source_id": supplement.getAttribute("id"),
      "type": "supplement",
      "label": label ? label.textContent : "",
      "url": url,
      "caption": null
    };

    // Add a caption if available
    var caption = supplement.querySelector("caption");

    if (caption) {
      var captionNode = this.caption(state, caption);
      if (captionNode) supplementNode.caption = captionNode.id;
    }
    
    // Let config enhance the node
    state.config.enhanceSupplement(state, supplementNode, supplement);
    doc.create(supplementNode);
    return supplementNode;
    // doc.show("figures", id);
  };


  // Used by Figure, Table, Video, Supplement types.
  // --------

  this.caption = function(state, caption) {
    var doc = state.doc;
    var title = caption.querySelector("title");

    // Only consider direct children
    var paragraphs = _.select(caption.querySelectorAll("p"), function(p) {
      return p.parentNode === caption;
    });

    if (paragraphs.length === 0) return null;

    var captionNode = {
      "id": state.nextId("caption"),
      "source_id": caption.getAttribute("id"),
      "type": "caption",
      "title": "",
      "children": []
    };

    // Titles can be annotated, thus delegate to paragraph
    if (title) {
      // Resolve title by delegating to the paragraph
      var nodes = this.paragraph(state, title);
      if (nodes.length > 0) {
        captionNode.title = nodes[0].id
      }
    }


    var children = [];
    _.each(paragraphs, function(p) {
      // Oliver: Explain, why we need NLMImporter.paragraph to return an array nodes?
      // I would expect it to return just one paragraph node. 
      var nodes = this.paragraph(state, p);
      if (nodes.length > 1) {
        // throw new ImporterError("Ooops. Not ready for that...");
        console.error("Ooops. Not ready for multiple nodes... only using the first one.");
      }
      if (nodes.length > 0) {
        var paragraphNode = nodes[0];
        children.push(paragraphNode.id);
      }
    }, this);

    captionNode.children = children;
    doc.create(captionNode);

    return captionNode;
  };


  // Example video element
  // 
  // <media content-type="glencoe play-in-place height-250 width-310" id="movie1" mime-subtype="mov" mimetype="video" xlink:href="elife00005m001.mov">
  //   <object-id pub-id-type="doi">
  //     10.7554/eLife.00005.013</object-id>
  //   <label>Movie 1.</label>
  //   <caption>
  //     <title>Movement of GFP tag.</title>
  //     <p>
  //       <bold>DOI:</bold>
  //       <ext-link ext-link-type="doi" xlink:href="10.7554/eLife.00005.013">http://dx.doi.org/10.7554/eLife.00005.013</ext-link>
  //     </p>
  //   </caption>
  // </media>

  this.video = function(state, video) {
    var doc = state.doc;

    var label = video.querySelector("label").textContent;

    var id = state.nextId("video");
    var videoNode = {
      "id": id,
      "source_id": video.getAttribute("id"),
      "type": "video",
      "label": label,
      "title": "",
      "caption": null,
      "poster": ""
    };

    // Add a caption if available
    var caption = video.querySelector("caption");
    if (caption) {
      var captionNode = this.caption(state, caption);
      if (captionNode) videoNode.caption = captionNode.id;
    }

    state.config.enhanceVideo(state, videoNode, video);
    doc.create(videoNode);

    return videoNode;
  };

  this.tableWrap = function(state, tableWrap) {
    var doc = state.doc;
    var label = tableWrap.querySelector("label").textContent;

    var tableNode = {
      "id": state.nextId("table"),
      "source_id": tableWrap.getAttribute("id"),
      "type": "table",
      "title": "",
      "label": label,
      "content": "",
      "caption": null,
      // Not supported yet ... need examples
      footers: [],
      // doi: "" needed?
    };

    // Note: using a DOM div element to create HTML
    var table = tableWrap.querySelector("table");
    tableNode.content = _toHtml(table);

    // Add a caption if available
    var caption = tableWrap.querySelector("caption");
    if (caption) {
      var captionNode = this.caption(state, caption);
      if (captionNode) tableNode.caption = captionNode.id;
    }

    state.config.enhanceTable(state, tableNode, tableWrap);
    doc.create(tableNode);
    return tableNode;
  };


  // Article
  // --------
  // Does the actual conversion.
  //
  // Note: this is implemented as lazy as possible (ALAP) and will be extended as demands arise.
  //
  // If you need such an element supported:
  //  - add a stub to this class (empty body),
  //  - add code to call the method to the appropriate function,
  //  - and implement the handler here if it can be done in general way
  //    or in your specialized importer.

  this.article = function(state, article) {

    // Assign id
    var articleId = article.querySelector("article-id");
    // Note: Substance.Article does only support one id
    if (articleId) {
      doc.id = articleId.textContent;
    } else {
      // if no id was set we create a random one
      doc.id = util.uuid();
    }

    // First extract all figure-ish content, using a global approach
    this.extractFigures(state, article);

    // Same for the citations, also globally
    this.extractCitations(state, article);

    var front = article.querySelector("front");
    if (!front) {
      throw new ImporterError("Expected to find a 'front' element.");
    } else {
      this.front(state, front);
    }

    var body = article.querySelector("body");
    if (body) {
      this.body(state, body);
    }

    // Give the config the chance to add stuff
    state.config.enhanceArticle(this, state, article);

    var back = article.querySelector("back");
    if (back) {
      this.back(state, back);
    }
  };


  // #### Front.ArticleMeta
  //

  this.articleMeta = function(state, articleMeta) {

    // <article-id> Article Identifier, zero or more
    var articleIds = articleMeta.querySelectorAll("article-id");
    this.articleIds(state, articleIds);

    // <title-group> Title Group, zero or one
    var titleGroup = articleMeta.querySelector("title-group");
    if (titleGroup) {
      this.titleGroup(state, titleGroup);
    }

    // TODO: the spec says, that there may be any combination of
    // 'contrib-group', 'aff', 'aff-alternatives', and 'x'
    // However, in the articles seen so far, these were sub-elements of 'contrib-group', which itself was single
    var contribGroup = articleMeta.querySelector("contrib-group");
    if (contribGroup) {
      this.contribGroup(state, contribGroup);
    }

    // <pub-date> Publication Date, zero or more
    var pubDates = articleMeta.querySelectorAll("pub-date");
    this.pubDates(state, pubDates);

    // <abstract> Abstract, zero or more
    var abstracts = articleMeta.querySelectorAll("abstract");

    _.each(abstracts, function(abs) {
      this.abstract(state, abs);
    }, this);

    // Not supported yet:
    // <trans-abstract> Translated Abstract, zero or more
    // <kwd-group> Keyword Group, zero or more
    // <funding-group> Funding Group, zero or more
    // <conference> Conference Information, zero or more
    // <counts> Counts, zero or one
    // <custom-meta-group> Custom Metadata Group, zero or one
  };

  // articleIds: array of <article-id> elements
  this.articleIds = function(state, articleIds) {
    var doc = state.doc;

    // Note: Substance.Article does only support one id
    if (articleIds.length > 0) {
      doc.id = articleIds[0].textContent;
    } else {
      // if no id was set we create a random one
      doc.id = util.uuid();
    }
  };

  this.titleGroup = function(state, titleGroup) {
    var doc = state.doc;

    var articleTitle = titleGroup.querySelector("article-title");
    if (articleTitle) {
      doc.title = articleTitle.textContent;
    }

    // Not yet supported:
    // <subtitle> Document Subtitle, zero or one
  };

  // Note: Substance.Article supports no publications directly.
  // We use the first pub-date for created_at
  this.pubDates = function(state, pubDates) {
    var doc = state.doc;
    if (pubDates.length > 0) {
      var converted = this.pubDate(state, pubDates[0]);
      doc.created_at = converted.date;
    }
  };

  // Note: this does not follow the spec but only takes the parts as it was necessary until now
  // TODO: implement it thoroughly
  this.pubDate = function(state, pubDate) {
    var day = -1;
    var month = -1;
    var year = -1;
    _.each(pubDate.children, function(el) {
      var type = this.getNodeType(el);

      var value = el.textContent;
      if (type === "day") {
        day = parseInt(value, 10);
      } else if (type === "month") {
        month = parseInt(value, 10);
      } else if (type === "year") {
        year = parseInt(value, 10);
      }
    }, this);
    var date = new Date(year, month, day);
    return {
      date: date
    };
  };

  this.abstract = function(state, abs) {
    var doc = state.doc;
    var nodes = [];

    var title = abs.querySelector("title");

    var heading = {
      id: state.nextId("heading"),
      type: "heading",
      level: 1,
      content: title ? title.textContent : "Abstract"
    };
    
    doc.create(heading);
    nodes.push(heading);

    nodes = nodes.concat(this.bodyNodes(state, abs.children));
    console.log('articlemeta', nodes);
    if (nodes.length > 0) {
      this.show(state, nodes);
    }
  };

  // ### Article.Body
  //

  this.body = function(state, body) {
    var nodes = this.bodyNodes(state, body.children);
    if (nodes.length > 0) {
      this.show(state, nodes);
    }
  };


  // Top-level elements as they can be found in the body or
  // in a section.
  this.bodyNodes = function(state, children, startIndex) {
    var nodes = [];

    startIndex = startIndex || 0;

    for (var i = startIndex; i < children.length; i++) {
      var child = children[i];
      var type = this.getNodeType(child);

      if (type === "p") {
        nodes = nodes.concat(this.paragraph(state, child));
      }
      else if (type === "sec") {
        nodes = nodes.concat(this.section(state, child));
      }
      else if (type === "list") {
        node = this.list(state, child);
        if (node) nodes.push(node);
      }
      else if (type === "fig") {
        // node = this.figure(state, child);
        // if (node) nodes.push(node);
      }
      else if (type === "fig-group") {
        // nodes = nodes.concat(this.figGroup(state, child));
      }
      else if (type === "table-wrap") {
        // node = this.tableWrap(state, child);
        // if (node) nodes.push(node);
      }
      else if (type === "disp-formula") {
        node = this.formula(state, child);
        if (node) nodes.push(node);
      }
      else if (type === "media") {
        // node = this.media(state, child);
        // if (node) nodes.push(node);
      }
      else if (type === "comment") {
        // Note: Maybe we could create a Substance.Comment?
        // Keep it silent for now
        // console.error("Ignoring comment");
      } else if (type === "boxed-text") {
        // var p = child.querySelector("p")
        // Just treat as another container
        nodes = nodes.concat(this.bodyNodes(state, child.children));
      } else {
        console.error("Node not yet supported within section: " + type);

        // throw new ImporterError("Node not yet supported within section: " + type);
      }
    }

    return nodes;
  };

  this.section = function(state, section) {

    // pushing the section level to track the level for nested sections
    state.sectionLevel++;

    var doc = state.doc;
    var children = section.children;

    // create a heading
    // TODO: headings can contain annotations too
    var title = children[0];
    var heading = {
      id: state.nextId("heading"),
      source_id: section.getAttribute("id"),
      type: "heading",
      level: state.sectionLevel,
      content: title.textContent
    };
    doc.create(heading);

    // Recursive Descent: get all section body nodes
    var nodes = this.bodyNodes(state, children, 1);
    // add the heading at the front
    nodes.unshift(heading);

    // popping the section level
    state.sectionLevel--;
 
    return nodes;
  };


  // A 'paragraph' is given a '<p>' tag
  this.paragraph = function(state, paragraph) {
    var doc = state.doc;

    // Note: there are some elements in the NLM paragraph allowed
    // which are not allowed in a Substance Paragraph.
    // I.e., they can not be nested inside, but must be added on top-level

    var nodes = [];

    var iterator = {
      childNodes: paragraph.childNodes,
      length: paragraph.childNodes.length,
      pos: 0
    };

    for (; iterator.pos < iterator.length; iterator.pos++) {
      var child = iterator.childNodes[iterator.pos];
      var type = this.getNodeType(child);
      var node;

      if (type === "text" || this.isAnnotation(type)) {
        node = {
          id: state.nextId("paragraph"),
          source_id: paragraph.getAttribute("id"),
          type: "paragraph",
          content: ""
        };

        // pushing information to the stack so that annotations can be created appropriately
        state.stack.push({
          node: node,
          path: [node.id, "content"]
        });

        // Note: this will consume as many textish elements (text and annotations)
        // but will return when hitting the first un-textish element.
        // In that case, the iterator will still have more elements
        // and the loop is continued
        var annotatedText = this.annotatedText(state, iterator, 0);

        // Ignore empty paragraphs
        if (!util.isEmpty(annotatedText)) {
          node.content = annotatedText;
          doc.create(node);
          nodes.push(node);
        }

        // popping the stack
        state.stack.pop();
      }
      else if (type === "list") {
        node = this.list(state, child);
        if (node) nodes.push(node);
      }
      else if (type === "disp-formula") {
        node = this.formula(state, child);
        if (node) nodes.push(node);
      }
    }

    return nodes;
  };


  // List type
  // --------

  this.list = function(state, list) {
    var doc = state.doc;

    var listNode = {
      "id": state.nextId("list"),
      "source_id": list.getAttribute("id"),
      "type": "list",
      "items": [],
      "ordered": false
    };

    // TODO: better detect ordererd list types (need examples)
    if (list.getAttribute("list-type") === "ordered") {
      listNode.ordered = true;
    }

    var listItems = list.querySelectorAll("list-item");
    for (var i = 0; i < listItems.length; i++) {
      var listItem = listItems[i];
      // Note: we do not care much about what is served as items
      // However, we do not have complex nodes on paragraph level
      // They will be extract as sibling items
      var nodes = this.bodyNodes(state, listItem.children, 0);
      for (var j = 0; j < nodes.length; j++) {
        listNode.items.push(nodes[j].id);
      }
    }

    doc.create(listNode);
    return listNode;
  };

  // Formula Node Type
  // --------

  this.formula = function(state, dispFormula) {
    var doc = state.doc;

    var formulaNode = {
      id: state.nextId("formula"),
      source_id: dispFormula.getAttribute("id"),
      type: "formula",
      label: "",
      data: "",
      format: ""
    };

    var label = dispFormula.querySelector("label");
    if (label) formulaNode.label = label.textContent;

    var children = dispFormula.children;

    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var type = this.getNodeType(child);

      if (type === "mml:math") {
        // TODO: is it really important to unwrap the mml:row?
        // why not just take the MathML directly?
        // Note: somehow it is not accepted to querySelect with "mml:row"
        var mmlRow = child.firstChild;
        formulaNode.format = "mathml";
        formulaNode.data = _toHtml(mmlRow);
      }
      else if (type === "tex-math") {
        formulaNode.format = "latex";
        formulaNode.data = child.textContent;
      }
    }

    if (formulaNode.format === "") {
      console.error("This formula is not yet supported", dispFormula);
      return null;
    } else {
      doc.create(formulaNode);
      return formulaNode;
    }
  };

  // Citations
  // ---------

  this.refList = function(state, refList) {
    var refs = refList.querySelectorAll("ref");
    for (var i = 0; i < refs.length; i++) {
      this.ref(state, refs[i]);
    }
  };

  this.ref = function(state, ref) {
    var children = ref.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var type = this.getNodeType(child);

      if (type === "mixed-citation" || type === "element-citation") {
        this.citation(state, ref, child);
      } else if (type === "label") {
        // ignoring it here...
      } else {
        console.error("Not supported in 'ref': ", type);
      }
    }
  };

  // TODO: is implemented naively, should be implemented considering the NLM spec
  this.citation = function(state, ref, citation) {
    var doc = state.doc;
    var citationNode;
    var i;

    var id = state.nextId("article_citation");

    // TODO: we should consider to have a more structured citation type
    // and let the view decide how to render it instead of blobbing everything here.
    var personGroup = citation.querySelector("person-group");

    // HACK: we try to create a 'articleCitation' when there is structured
    // content (ATM, when personGroup is present)
    // Otherwise we create a mixed-citation taking the plain text content of the element
    if (personGroup) {

      citationNode = {
        "id": id,
        "source_id": ref.getAttribute("id"),
        "type": "citation",
        "title": "N/A",
        "label": "",
        "authors": [],
        "doi": "",
        "source": "",
        "volume": "",
        "fpage": "",
        "lpage": "",
        "citation_urls": []
      };

      var nameElements = personGroup.querySelectorAll("name");
      for (i = 0; i < nameElements.length; i++) {
        citationNode.authors.push(_getName(nameElements[i]));
      }

      var articleTitle = citation.querySelector("article-title");
      if (articleTitle) {
        citationNode.title = articleTitle.textContent;
      } else {
        console.error("FIXME: this citation has no title", citation);
      }

      var source = citation.querySelector("source");
      if (source) citationNode.source = source.textContent;

      var volume = citation.querySelector("volume");
      if (volume) citationNode.volume = volume.textContent;

      var fpage = citation.querySelector("fpage");
      if (fpage) citationNode.fpage = fpage.textContent;

      var lpage = citation.querySelector("lpage");
      if (lpage) citationNode.lpage = lpage.textContent;

      var year = citation.querySelector("year");
      if (year) citationNode.year = year.textContent;

      // Note: the label is child of 'ref'
      var label = ref.querySelector("label");
      if(label) citationNode.label = label.textContent;

      var doi = citation.querySelector("pub-id[pub-id-type='doi'], ext-link[ext-link-type='doi']");
      if(doi) citationNode.doi = "http://dx.doi.org/" + doi.textContent;       
    } else {
      console.error("FIXME: there is one of those 'mixed-citation' without any structure. Skipping ...", citation);
      return;
      // citationNode = {
      //   id: id,
      //   type: "mixed_citation",
      //   citation: citation.textContent,
      //   doi: ""
      // };
    }

    doc.create(citationNode);
    doc.show("citations", id);
  };

  // Article.Back
  // --------
  // Contains things like references, notes, etc.

  this.back = function(state, back) {
    // No processing at the moment
    // citations are taken care of in a global handler.
  };
};


LensImporter.State = function(xmlDoc, doc) {
  // the input xml document
  this.xmlDoc = xmlDoc;

  // the output substance document
  this.doc = doc;

  // store annotations to be created here
  // they will be added to the document when everything else is in place
  this.annotations = [];

  // when recursing into sub-nodes it is necessary to keep the stack
  // of processed nodes to be able to associate other things (e.g., annotations) correctly.
  this.stack = [];

  this.sectionLevel = 0;

  // an id generator for different types
  var ids = {};
  this.nextId = function(type) {
    ids[type] = ids[type] || 0;
    ids[type]++;
    return type +"_"+ids[type];
  };
};

// LensImporter.Prototype.prototype = NLMImporter.prototype;
LensImporter.prototype = new LensImporter.Prototype();

module.exports = {
  Importer: LensImporter
};
