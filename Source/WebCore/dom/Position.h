/*
 * Copyright (C) 2004-2020 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

#pragma once

#include "ContainerNode.h"
#include "EditingBoundary.h"
#include "TextAffinity.h"

namespace WTF {
class TextStream;
}

namespace WebCore {

class InlineBox;
class RenderElement;
class Text;

struct BoundaryPoint;

enum PositionMoveType {
    CodePoint,       // Move by a single code point.
    Character,       // Move to the next Unicode character break.
    BackwardDeletion // Subject to platform conventions.
};

class Position {
public:
    enum AnchorType {
        PositionIsOffsetInAnchor,
        PositionIsBeforeAnchor,
        PositionIsAfterAnchor,
        PositionIsBeforeChildren,
        PositionIsAfterChildren,
    };

    Position()
        : m_anchorType(PositionIsOffsetInAnchor)
        , m_isLegacyEditingPosition(false)
    {
    }

    // For creating before/after positions:
    WEBCORE_EXPORT Position(Node* anchorNode, AnchorType);
    Position(Text* textNode, unsigned offset);

    // For creating offset positions:
    // FIXME: This constructor should eventually go away. See bug 63040.
    WEBCORE_EXPORT Position(Node* anchorNode, unsigned offset, AnchorType);

    AnchorType anchorType() const { return static_cast<AnchorType>(m_anchorType); }

    void clear() { m_anchorNode = nullptr; m_offset = 0; m_anchorType = PositionIsOffsetInAnchor; m_isLegacyEditingPosition = false; }

    // These are always DOM compliant values.  Editing positions like [img, 0] (aka [img, before])
    // will return img->parentNode() and img->computeNodeIndex() from these functions.
    WEBCORE_EXPORT Node* containerNode() const; // null for a before/after position anchored to a node with no parent
    Text* containerText() const;

    int computeOffsetInContainerNode() const;  // O(n) for before/after-anchored positions, O(1) for parent-anchored positions
    WEBCORE_EXPORT Position parentAnchoredEquivalent() const; // Convenience method for DOM positions that also fixes up some positions for editing

    // Inline O(1) access for Positions which callers know to be parent-anchored
    int offsetInContainerNode() const
    {
        ASSERT(anchorType() == PositionIsOffsetInAnchor);
        return m_offset;
    }

    // New code should not use this function.
    int deprecatedEditingOffset() const
    {
        if (m_isLegacyEditingPosition || (m_anchorType != PositionIsAfterAnchor && m_anchorType != PositionIsAfterChildren))
            return m_offset;
        return offsetForPositionAfterAnchor();
    }

    RefPtr<Node> firstNode() const;

    // These are convenience methods which are smart about whether the position is neighbor anchored or parent anchored
    WEBCORE_EXPORT Node* computeNodeBeforePosition() const;
    WEBCORE_EXPORT Node* computeNodeAfterPosition() const;

    Node* anchorNode() const { return m_anchorNode.get(); }

    // FIXME: Callers should be moved off of node(), node() is not always the container for this position.
    // For nodes which editingIgnoresContent(node()) returns true, positions like [ignoredNode, 0]
    // will be treated as before ignoredNode (thus node() is really after the position, not containing it).
    Node* deprecatedNode() const { return m_anchorNode.get(); }

    Document* document() const { return m_anchorNode ? &m_anchorNode->document() : nullptr; }
    TreeScope* treeScope() const { return m_anchorNode ? &m_anchorNode->treeScope() : nullptr; }
    Element* rootEditableElement() const
    {
        Node* container = containerNode();
        return container ? container->rootEditableElement() : nullptr;
    }

    // These should only be used for PositionIsOffsetInAnchor positions, unless
    // the position is a legacy editing position.
    void moveToPosition(Node* anchorNode, unsigned offset);
    void moveToOffset(unsigned offset);

    bool isNull() const { return !m_anchorNode; }
    bool isNotNull() const { return m_anchorNode; }
    bool isOrphan() const { return m_anchorNode && !m_anchorNode->isConnected(); }

    Element* element() const;

    // Move up or down the DOM by one position.
    // Offsets are computed using render text for nodes that have renderers - but note that even when
    // using composed characters, the result may be inside a single user-visible character if a ligature is formed.
    WEBCORE_EXPORT Position previous(PositionMoveType = CodePoint) const;
    WEBCORE_EXPORT Position next(PositionMoveType = CodePoint) const;
    static int uncheckedPreviousOffset(const Node*, unsigned current);
    static int uncheckedPreviousOffsetForBackwardDeletion(const Node*, unsigned current);
    static int uncheckedNextOffset(const Node*, unsigned current);

    // These can be either inside or just before/after the node, depending on
    // if the node is ignored by editing or not.
    // FIXME: These should go away. They only make sense for legacy positions.
    bool atFirstEditingPositionForNode() const;
    bool atLastEditingPositionForNode() const;

    // Returns true if the visually equivalent positions around have different editability
    bool atEditingBoundary() const;
    Node* parentEditingBoundary() const;
    
    bool atStartOfTree() const;
    bool atEndOfTree() const;

    // FIXME: Make these non-member functions and put them somewhere in the editing directory.
    // These aren't really basic "position" operations. More high level editing helper functions.
    WEBCORE_EXPORT Position leadingWhitespacePosition(EAffinity, bool considerNonCollapsibleWhitespace = false) const;
    WEBCORE_EXPORT Position trailingWhitespacePosition(EAffinity, bool considerNonCollapsibleWhitespace = false) const;
    
    // These return useful visually equivalent positions.
    WEBCORE_EXPORT Position upstream(EditingBoundaryCrossingRule = CannotCrossEditingBoundary) const;
    WEBCORE_EXPORT Position downstream(EditingBoundaryCrossingRule = CannotCrossEditingBoundary) const;
    
    bool isCandidate() const;
    bool isRenderedCharacter() const;
    bool rendersInDifferentPosition(const Position&) const;

    void getInlineBoxAndOffset(EAffinity, InlineBox*&, int& caretOffset) const;
    void getInlineBoxAndOffset(EAffinity, TextDirection primaryDirection, InlineBox*&, int& caretOffset) const;

    TextDirection primaryDirection() const;

    // Returns the number of positions that exist between two positions.
    static unsigned positionCountBetweenPositions(const Position&, const Position&);

    static bool hasRenderedNonAnonymousDescendantsWithHeight(const RenderElement&);
    static bool nodeIsUserSelectNone(Node*);
#if ENABLE(USERSELECT_ALL)
    static bool nodeIsUserSelectAll(const Node*);
    static Node* rootUserSelectAllForNode(Node*);
#else
    static bool nodeIsUserSelectAll(const Node*) { return false; }
    static Node* rootUserSelectAllForNode(Node*) { return 0; }
#endif

    void debugPosition(const char* msg = "") const;

#if ENABLE(TREE_DEBUGGING)
    void formatForDebugger(char* buffer, unsigned length) const;
    void showAnchorTypeAndOffset() const;
    void showTreeForThis() const;
#endif

    // This is a tentative enhancement of operator== to account for different position types.
    // FIXME: Combine this function with operator==
    bool equals(const Position&) const;

private:
    // For creating legacy editing positions: (Anchor type will be determined from editingIgnoresContent(node))
    enum class LegacyEditingPositionFlag { On };
    WEBCORE_EXPORT Position(Node* anchorNode, unsigned offset, LegacyEditingPositionFlag);
    friend Position createLegacyEditingPosition(Node*, unsigned offset);

    WEBCORE_EXPORT int offsetForPositionAfterAnchor() const;
    
    Position previousCharacterPosition(EAffinity) const;
    Position nextCharacterPosition(EAffinity) const;

    static AnchorType anchorTypeForLegacyEditingPosition(Node* anchorNode, unsigned offset);

    RefPtr<Node> m_anchorNode;
    // m_offset can be the offset inside m_anchorNode, or if editingIgnoresContent(m_anchorNode)
    // returns true, then other places in editing will treat m_offset == 0 as "before the anchor"
    // and m_offset > 0 as "after the anchor node".  See parentAnchoredEquivalent for more info.
    unsigned m_offset { 0 };
    unsigned m_anchorType : 3;
    bool m_isLegacyEditingPosition : 1;
};

bool operator==(const Position&, const Position&);
bool operator!=(const Position&, const Position&);
bool operator<(const Position&, const Position&);
bool operator>(const Position&, const Position&);
bool operator>=(const Position&, const Position&);
bool operator<=(const Position&, const Position&);

// FIXME: Consider renaming this to "make" instead of "create" since we normally use "create" for functions that allocate heap objects.
Position createLegacyEditingPosition(Node*, unsigned offset);
WEBCORE_EXPORT Position createLegacyEditingPosition(const BoundaryPoint&);

WEBCORE_EXPORT Optional<BoundaryPoint> makeBoundaryPoint(const Position&);

Position positionInParentBeforeNode(Node*);
Position positionInParentAfterNode(Node*);

// positionBeforeNode and positionAfterNode return neighbor-anchored positions, construction is O(1)
Position positionBeforeNode(Node* anchorNode);
Position positionAfterNode(Node* anchorNode);

int lastOffsetInNode(Node*);

// firstPositionInNode and lastPositionInNode return parent-anchored positions, lastPositionInNode construction is O(n) due to countChildNodes()
Position firstPositionInNode(Node* anchorNode);
Position lastPositionInNode(Node* anchorNode);

int minOffsetForNode(Node* anchorNode, unsigned offset);
bool offsetIsBeforeLastNodeOffset(unsigned offset, Node* anchorNode);

RefPtr<Node> commonShadowIncludingAncestor(const Position&, const Position&);

WTF::TextStream& operator<<(WTF::TextStream&, const Position&);

// inlines

inline Position createLegacyEditingPosition(Node* node, unsigned offset)
{
    return { node, offset, Position::LegacyEditingPositionFlag::On };
}

inline bool operator==(const Position& a, const Position& b)
{
    // FIXME: In <div><img></div> [div, 0] != [img, 0] even though most of the
    // editing code will treat them as identical.
    return a.anchorNode() == b.anchorNode() && a.deprecatedEditingOffset() == b.deprecatedEditingOffset() && a.anchorType() == b.anchorType();
}

inline bool operator!=(const Position& a, const Position& b)
{
    return !(a == b);
}

inline bool operator<(const Position& a, const Position& b)
{
    if (a.isNull() || b.isNull())
        return false;
    if (a.anchorNode() == b.anchorNode())
        return a.deprecatedEditingOffset() < b.deprecatedEditingOffset();
    return b.anchorNode()->compareDocumentPosition(*a.anchorNode()) == Node::DOCUMENT_POSITION_PRECEDING;
}

inline bool operator>(const Position& a, const Position& b) 
{
    return !a.isNull() && !b.isNull() && a != b && b < a;
}

inline bool operator>=(const Position& a, const Position& b) 
{
    return !a.isNull() && !b.isNull() && (a == b || a > b);
}

inline bool operator<=(const Position& a, const Position& b) 
{
    return !a.isNull() && !b.isNull() && (a == b || a < b);
}

// positionBeforeNode and positionAfterNode return neighbor-anchored positions, construction is O(1)
inline Position positionBeforeNode(Node* anchorNode)
{
    ASSERT(anchorNode);
    return Position(anchorNode, Position::PositionIsBeforeAnchor);
}

inline Position positionAfterNode(Node* anchorNode)
{
    ASSERT(anchorNode);
    return Position(anchorNode, Position::PositionIsAfterAnchor);
}

inline int lastOffsetInNode(Node* node)
{
    return node->isCharacterDataNode() ? node->maxCharacterOffset() : node->countChildNodes();
}

// firstPositionInNode and lastPositionInNode return parent-anchored positions, lastPositionInNode construction is O(n) due to countChildNodes()
inline Position firstPositionInNode(Node* anchorNode)
{
    if (anchorNode->isTextNode())
        return Position(anchorNode, 0, Position::PositionIsOffsetInAnchor);
    return Position(anchorNode, Position::PositionIsBeforeChildren);
}

inline Position lastPositionInNode(Node* anchorNode)
{
    if (anchorNode->isTextNode())
        return Position(anchorNode, lastOffsetInNode(anchorNode), Position::PositionIsOffsetInAnchor);
    return Position(anchorNode, Position::PositionIsAfterChildren);
}

inline int minOffsetForNode(Node* anchorNode, unsigned offset)
{
    if (anchorNode->isCharacterDataNode())
        return std::min<unsigned>(offset, anchorNode->maxCharacterOffset());

    unsigned newOffset = 0;
    for (Node* node = anchorNode->firstChild(); node && newOffset < offset; node = node->nextSibling())
        newOffset++;
    
    return newOffset;
}

inline bool offsetIsBeforeLastNodeOffset(unsigned offset, Node* anchorNode)
{
    if (anchorNode->isCharacterDataNode())
        return offset < static_cast<unsigned>(anchorNode->maxCharacterOffset());

    unsigned currentOffset = 0;
    for (Node* node = anchorNode->firstChild(); node && currentOffset < offset; node = node->nextSibling())
        currentOffset++;
    
    
    return offset < currentOffset;
}

} // namespace WebCore

#if ENABLE(TREE_DEBUGGING)
// Outside the WebCore namespace for ease of invocation from the debugger.
void showTree(const WebCore::Position&);
void showTree(const WebCore::Position*);
#endif
